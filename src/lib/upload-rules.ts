// What may be uploaded, shared by the browser (FileUploadZone, the logo
// pickers) and the server (src/lib/uploads.ts, which also checks the file's
// content). No server imports here, so client components can use it.

// Uploads reach the server as FormData through a route handler. On Vercel a
// function's request body is capped at 4.5 MB, so attachments stop at 4 MB
// to leave room for the multipart overhead.
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024
export const LOGO_MAX_BYTES = 2 * 1024 * 1024
// The clients CSV import reads the file in the browser and posts the rows as
// JSON, so the file limit is checked in the browser and the route caps the
// JSON body it receives
export const CSV_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const IMPORT_BODY_MAX_BYTES = 4 * 1024 * 1024

export type UploadProfile = "ATTACHMENT" | "LOGO"

export interface UploadTypeRule {
  contentType: string
  // Images the browser may show inline. Every other type is served as a
  // download (Content-Disposition: attachment).
  inline: boolean
}

// Keyed by lowercase extension. Anything missing from a profile's list is
// refused, which covers HTML, SVG, XML, scripts, and executables.
export const UPLOAD_TYPES: Record<string, UploadTypeRule> = {
  pdf: { contentType: "application/pdf", inline: false },
  png: { contentType: "image/png", inline: true },
  jpg: { contentType: "image/jpeg", inline: true },
  jpeg: { contentType: "image/jpeg", inline: true },
  gif: { contentType: "image/gif", inline: true },
  webp: { contentType: "image/webp", inline: true },
  doc: { contentType: "application/msword", inline: false },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  xls: { contentType: "application/vnd.ms-excel", inline: false },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  ppt: { contentType: "application/vnd.ms-powerpoint", inline: false },
  pptx: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false },
  csv: { contentType: "text/csv; charset=utf-8", inline: false },
  txt: { contentType: "text/plain; charset=utf-8", inline: false },
  zip: { contentType: "application/zip", inline: false },
}

export const PROFILE_EXTENSIONS: Record<UploadProfile, readonly string[]> = {
  ATTACHMENT: ["pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip"],
  // SVG is refused for new logos: it can carry script
  LOGO: ["png", "jpg", "jpeg", "webp"],
}

export const PROFILE_MAX_BYTES: Record<UploadProfile, number> = {
  ATTACHMENT: ATTACHMENT_MAX_BYTES,
  LOGO: LOGO_MAX_BYTES,
}

// For the file inputs' accept attribute
export function acceptAttribute(profile: UploadProfile): string {
  return PROFILE_EXTENSIONS[profile].map((ext) => `.${ext}`).join(",")
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

export const UPLOAD_MESSAGES = {
  typeNotAllowed: "That file type is not allowed",
  contentMismatch: "That file's contents do not match its type",
  empty: "That file is empty",
  missing: "No file provided",
  tooLarge: (maxBytes: number) => `That file is larger than ${formatMegabytes(maxBytes)}`,
}

// The lowercase extension after the last dot, or "" when there is none
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ""
  const dot = base.lastIndexOf(".")
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : ""
}

// The checks the browser can make before uploading: the extension and the
// size. Returns the message to show, or null when the file may be sent.
// The server repeats these and also checks the file's content.
export function checkUploadBasics(file: { name: string; size: number }, profile: UploadProfile): string | null {
  if (!PROFILE_EXTENSIONS[profile].includes(fileExtension(file.name))) return UPLOAD_MESSAGES.typeNotAllowed
  if (file.size > PROFILE_MAX_BYTES[profile]) return UPLOAD_MESSAGES.tooLarge(PROFILE_MAX_BYTES[profile])
  if (file.size === 0) return UPLOAD_MESSAGES.empty
  return null
}
