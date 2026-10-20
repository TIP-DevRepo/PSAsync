import { randomUUID } from "crypto"
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse } from "next/server"
import {
  PROFILE_EXTENSIONS,
  PROFILE_MAX_BYTES,
  UPLOAD_MESSAGES,
  UPLOAD_TYPES,
  fileExtension,
  type UploadProfile,
} from "@/lib/upload-rules"
import { attachmentDisposition } from "@/lib/content-disposition"

// The only place that validates uploaded files and writes to or deletes
// from the uploads bucket. Every upload route reads its file with
// readUpload, stores it with storeUpload, and removes stored objects with
// deleteStoredObject. The allowed types and size limits live in
// src/lib/upload-rules.ts so the browser can check them too.

let s3Client: S3Client | null = null

function client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  }
  return s3Client
}

// Every stored file's public URL starts with this, the same format the
// app has always saved
export function bucketBaseUrl(): string {
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`
}

// ─── Validation ─────────────────────────────────────────────────────────

export interface ValidatedFile {
  ext: string
  contentType: string
  inline: boolean
  // The original name, cleaned up for display and the download name
  displayName: string
  size: number
  bytes: Uint8Array
}

export type ValidationResult = { ok: true; file: ValidatedFile } | { ok: false; error: string }

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((b, i) => bytes[offset + i] === b)
}

// UTF-8 text with no NUL bytes, for CSV and TXT
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// Whether the file's first bytes match what its extension claims
export function contentMatches(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(bytes, PDF)
    case "png":
      return startsWith(bytes, PNG)
    case "jpg":
    case "jpeg":
      return startsWith(bytes, JPEG)
    case "gif":
      return startsWith(bytes, GIF87) || startsWith(bytes, GIF89)
    case "webp":
      return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)
    // Office Open XML files are ZIP containers
    case "docx":
    case "xlsx":
    case "pptx":
      return startsWith(bytes, ZIP)
    case "zip":
      return startsWith(bytes, ZIP) || startsWith(bytes, ZIP_EMPTY)
    // Legacy Office files are OLE compound documents
    case "doc":
    case "xls":
    case "ppt":
      return startsWith(bytes, OLE)
    case "csv":
    case "txt":
      return isPlainText(bytes)
    default:
      return false
  }
}

const MAX_NAME_LENGTH = 150

// For display only, never part of a storage key: no path separators or
// control characters, whitespace collapsed, at most MAX_NAME_LENGTH
// characters with the extension kept
export function sanitizeFileName(name: string, ext: string): string {
  let clean = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const suffix = ext ? `.${ext}` : ""
  if (!clean || clean === suffix) clean = `file${suffix}`
  if (clean.length > MAX_NAME_LENGTH) {
    const keepsExt = suffix && clean.toLowerCase().endsWith(suffix)
    const stem = keepsExt ? clean.slice(0, clean.length - suffix.length) : clean
    clean = `${stem.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${keepsExt ? clean.slice(-suffix.length) : suffix}`
  }
  return clean
}

// Checks the extension against the profile's list, the size, and that the
// content matches the extension. The browser's Content-Type is never used.
export function validateUpload(
  input: { name: string; bytes: Uint8Array },
  profile: UploadProfile
): ValidationResult {
  const ext = fileExtension(input.name)
  const rule = UPLOAD_TYPES[ext]
  if (!rule || !PROFILE_EXTENSIONS[profile].includes(ext)) return { ok: false, error: UPLOAD_MESSAGES.typeNotAllowed }
  const maxBytes = PROFILE_MAX_BYTES[profile]
  if (input.bytes.length > maxBytes) return { ok: false, error: UPLOAD_MESSAGES.tooLarge(maxBytes) }
  if (input.bytes.length === 0) return { ok: false, error: UPLOAD_MESSAGES.empty }
  if (!contentMatches(ext, input.bytes)) return { ok: false, error: UPLOAD_MESSAGES.contentMismatch }
  return {
    ok: true,
    file: {
      ext,
      contentType: rule.contentType,
      inline: rule.inline,
      displayName: sanitizeFileName(input.name, ext),
      size: input.bytes.length,
      bytes: input.bytes,
    },
  }
}

export type ReadUploadResult =
  | { file: ValidatedFile; response?: undefined }
  | { file?: undefined; response: NextResponse }

// The same { error } shape as apiError in src/lib/api-access.ts, built here
// so this module doesn't load the sign in setup
function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

// Reads the "file" field from an upload request's form data and validates
// it. The size is checked before the bytes are read.
export async function readUpload(formData: FormData, profile: UploadProfile): Promise<ReadUploadResult> {
  const entry = formData.get("file")
  if (!entry || typeof entry === "string") return { response: badRequest(UPLOAD_MESSAGES.missing) }
  const maxBytes = PROFILE_MAX_BYTES[profile]
  if (entry.size > maxBytes) return { response: badRequest(UPLOAD_MESSAGES.tooLarge(maxBytes)) }
  const bytes = new Uint8Array(await entry.arrayBuffer())
  const result = validateUpload({ name: entry.name, bytes }, profile)
  if (!result.ok) return { response: badRequest(result.error) }
  return { file: result.file }
}

// Reads the request's form data and its file in one step. A body that
// isn't form data gets the same 400 as a missing file.
export async function readUploadFromRequest(req: Request, profile: UploadProfile): Promise<ReadUploadResult> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return { response: badRequest(UPLOAD_MESSAGES.missing) }
  }
  return readUpload(formData, profile)
}

// ─── Keys ───────────────────────────────────────────────────────────────

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/

// A storage key that never contains the original file name: the record
// type's folder, a random UUID, and the validated extension. namePrefix
// (letters, digits, - and _ only) goes in front of the UUID, for the flat
// logos folder.
export function buildObjectKey(folder: string, ext: string, namePrefix = ""): string {
  const segments = folder.split("/")
  if (!segments.every((s) => SAFE_SEGMENT.test(s))) throw new Error(`Unsafe upload folder: ${folder}`)
  if (namePrefix && !SAFE_SEGMENT.test(namePrefix)) throw new Error("Unsafe upload name prefix")
  if (!UPLOAD_TYPES[ext]) throw new Error(`Unknown upload extension: ${ext}`)
  return `${folder}/${namePrefix}${randomUUID()}.${ext}`
}

// ─── Storage ────────────────────────────────────────────────────────────

// The original name as a download name: an ASCII fallback plus the exact
// name encoded per RFC 5987, through the shared helper every download uses
export function contentDisposition(displayName: string): string {
  return attachmentDisposition(displayName, "file")
}

export const ATTACHMENT_CACHE_CONTROL = "private, max-age=86400"

// What the upload call sends, worked out from the validated file only
export function putObjectParams(file: ValidatedFile, key: string, profile: UploadProfile) {
  return {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: file.bytes,
    ContentType: file.contentType,
    ...(file.inline ? {} : { ContentDisposition: contentDisposition(file.displayName) }),
    ...(profile === "ATTACHMENT" ? { CacheControl: ATTACHMENT_CACHE_CONTROL } : {}),
  }
}

// Stores a validated file and returns its public URL
export async function storeUpload(
  file: ValidatedFile,
  target: { folder: string; profile: UploadProfile; namePrefix?: string }
): Promise<string> {
  const key = buildObjectKey(target.folder, file.ext, target.namePrefix)
  await client().send(new PutObjectCommand(putObjectParams(file, key, target.profile)))
  return `${bucketBaseUrl()}${key}`
}

export type DeleteResult =
  | { ok: true; key: string }
  | { ok: false; reason: "refused" | "failed"; key?: string }

// The bucket key for a stored URL, or null when the URL is not one of this
// app's objects under expectedPrefix (for example "vendors/abc123/")
export function storedObjectKey(url: string | null | undefined, expectedPrefix: string): string | null {
  if (!url || !expectedPrefix) return null
  const base = bucketBaseUrl()
  if (!url.startsWith(base)) return null
  const key = url.slice(base.length)
  if (!key.startsWith(expectedPrefix) || key.length === expectedPrefix.length) return null
  if (/[\u0000-\u001f\u007f?#\\]/.test(key) || key.split("/").some((s) => s === ".." || s === ".")) return null
  return key
}

// Best effort: deletes the object behind a URL saved by this app. Anything
// outside the app's bucket or the expected prefix is refused. A failure
// (including credentials without delete permission) is logged with the key
// and never thrown, so the caller's own work always stands.
export async function deleteStoredObject(url: string | null | undefined, expectedPrefix: string): Promise<DeleteResult> {
  const key = storedObjectKey(url, expectedPrefix)
  if (!key) {
    if (url) console.warn(`deleteStoredObject: refused a URL outside ${expectedPrefix} in the uploads bucket`)
    return { ok: false, reason: "refused" }
  }
  try {
    await client().send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME, Key: key }))
    return { ok: true, key }
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error"
    console.error(
      `deleteStoredObject: could not delete stored file ${key} (${name}). ` +
        (name === "AccessDenied" ? "The storage credentials may not allow deleting. " : "") +
        "The record was still removed, the file is left in the bucket."
    )
    return { ok: false, reason: "failed", key }
  }
}

// deleteStoredObject for several URLs, one at a time so a large cleanup
// never floods the bucket. Never throws.
export async function deleteStoredObjects(urls: (string | null | undefined)[], expectedPrefix: string): Promise<DeleteResult[]> {
  const results: DeleteResult[] = []
  for (const url of urls) results.push(await deleteStoredObject(url, expectedPrefix))
  return results
}
