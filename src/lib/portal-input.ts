// Limits and checks for everything a customer sends to the public portal
// routes (accept, decline, comments, line item changes). Kept free of
// database imports so the portal page can share the limits for its inputs.

export const PORTAL_DECLINE_REASON_MAX = 2000
export const PORTAL_COMMENT_MAX = 2000
// Signer name, PO number, and each ship to field
export const PORTAL_NAME_MAX = 200
// A drawn signature is a PNG data URL from the signature pad
export const PORTAL_DRAWN_SIGNATURE_MAX = 500_000
// Quantities a customer may set on an adjustable line: whole numbers from
// 0 (the existing lower bound) up to this
export const PORTAL_QUANTITY_MAX = 100_000

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): Checked<T> => ({ ok: true, value })
const bad = (error: string): Checked<never> => ({ ok: false, error })

// A required string, trimmed, 1 to max characters
export function requiredText(value: unknown, label: string, max: number): Checked<string> {
  if (typeof value !== "string" || !value.trim()) return bad(`${label} is required`)
  const trimmed = value.trim()
  if (trimmed.length > max) return bad(`${label} must be ${max} characters or fewer`)
  return ok(trimmed)
}

// An optional string, trimmed: undefined when it wasn't sent, null when it
// was sent empty or null, otherwise up to max characters
export function optionalText(value: unknown, label: string, max: number): Checked<string | null | undefined> {
  if (value === undefined) return ok(undefined)
  if (value === null) return ok(null)
  if (typeof value !== "string") return bad(`${label} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) return bad(`${label} must be ${max} characters or fewer`)
  return ok(trimmed || null)
}

export function checkQuantity(value: unknown): Checked<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > PORTAL_QUANTITY_MAX) {
    return bad(`Quantity must be a whole number from 0 to ${PORTAL_QUANTITY_MAX}`)
  }
  return ok(value)
}

export function checkOptionalSelected(value: unknown): Checked<boolean> {
  if (typeof value !== "boolean") return bad("Invalid option selection")
  return ok(value)
}

export interface AcceptInput {
  signatureType: "TYPED" | "DRAWN"
  signatureData: string
  signerName: string
  // undefined means the field wasn't sent and the quote keeps its value
  clientPoNumber: string | null | undefined
  shipAddress: string | null | undefined
  shipCity: string | null | undefined
  shipState: string | null | undefined
  shipZip: string | null | undefined
  shipCountry: string | null | undefined
  shipContactName: string | null | undefined
}

const SHIP_FIELDS = [
  ["clientPoNumber", "PO number"],
  ["shipAddress", "Address"],
  ["shipCity", "City"],
  ["shipState", "State"],
  ["shipZip", "ZIP code"],
  ["shipCountry", "Country"],
  ["shipContactName", "Ship to contact"],
] as const

// The accept body: a typed or drawn signature, a named signer, agreeing to
// the terms, and the optional PO number and ship to details
export function checkAcceptBody(body: Record<string, unknown>): Checked<AcceptInput> {
  if (body.signatureType !== "TYPED" && body.signatureType !== "DRAWN") return bad("A signature is required")
  const signatureType = body.signatureType

  if (typeof body.signatureData !== "string" || !body.signatureData.trim()) return bad("A signature is required")
  let signatureData: string
  if (signatureType === "TYPED") {
    signatureData = body.signatureData.trim()
    if (signatureData.length > PORTAL_NAME_MAX) return bad(`Signature must be ${PORTAL_NAME_MAX} characters or fewer`)
  } else {
    signatureData = body.signatureData
    if (!signatureData.startsWith("data:image/png;base64,")) return bad("A signature is required")
    if (signatureData.length > PORTAL_DRAWN_SIGNATURE_MAX) return bad("That signature is too large")
  }

  const signer = requiredText(body.signerName, "Signer name", PORTAL_NAME_MAX)
  if (!signer.ok) return signer
  if (body.termsAgreed !== true) return bad("You must agree to the terms and conditions")

  const fields: Record<string, string | null | undefined> = {}
  for (const [key, label] of SHIP_FIELDS) {
    const checked = optionalText(body[key], label, PORTAL_NAME_MAX)
    if (!checked.ok) return checked
    fields[key] = checked.value
  }

  return ok({
    signatureType,
    signatureData,
    signerName: signer.value,
    clientPoNumber: fields.clientPoNumber,
    shipAddress: fields.shipAddress,
    shipCity: fields.shipCity,
    shipState: fields.shipState,
    shipZip: fields.shipZip,
    shipCountry: fields.shipCountry,
    shipContactName: fields.shipContactName,
  })
}

// Reads a JSON body as a plain object. Anything else (bad JSON, an array,
// a string) reads as an empty object, so the field checks refuse it.
export async function readPortalBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}
