import type { OpportunityStageCategory } from "@/generated/prisma"

// The rules the opportunity, stage, type, and settings routes share. No
// database imports, so every rule here can be checked on its own.

export const OPPORTUNITY_TITLE_MAX = 200
export const OPPORTUNITY_NOTES_MAX = 10000
// Stage and type names
export const OPPORTUNITY_NAME_MAX = 100
// The list's text search
export const OPPORTUNITY_SEARCH_MAX = 200

export const CATEGORY_LABELS: Record<OpportunityStageCategory, string> = { OPEN: "Open", WON: "Won", LOST: "Lost" }

export const WIN_PROBABILITY_MESSAGE = "Win probability must be a whole number from 0 to 100"
export const EXPECTED_VALUE_MESSAGE = "Expected value must be a number from 0 to 9999999999.99, with at most 2 decimal places"
export const CLOSE_DATE_MESSAGE = "Expected close date must be a valid date"
export const QUOTE_SENT_STAGE_OPEN_MESSAGE = "The stage a sent quote moves to must be an open stage"
export const STAGE_ORDER_MESSAGE = "Invalid stage order"
export const STAGE_ORDER_STALE_MESSAGE = "The stage list changed since you loaded it. Refresh and try again."

// ─── Stage changes ──────────────────────────────────────────────────────────

export function isClosedCategory(category: OpportunityStageCategory): boolean {
  return category !== "OPEN"
}

// closedAt for an opportunity created in a stage of this category
export function closedAtFor(category: OpportunityStageCategory, now: Date): Date | null {
  return isClosedCategory(category) ? now : null
}

// What moving an opportunity from one stage to another writes: the new
// stage, stageChangedAt, and closedAt (set moving into a WON or LOST stage,
// cleared moving into an OPEN one). Nothing when the stage stays the same.
export function stageChangeData(
  from: { id: string },
  to: { id: string; category: OpportunityStageCategory },
  now: Date
): { stageId: string; stageChangedAt: Date; closedAt: Date | null } | Record<string, never> {
  if (from.id === to.id) return {}
  return { stageId: to.id, stageChangedAt: now, closedAt: closedAtFor(to.category, now) }
}

// ─── Body values ────────────────────────────────────────────────────────────

export const INVALID_BODY_MESSAGE = "Invalid request body"

// The JSON object a request sent, or null for anything else (no body,
// broken JSON, a list)
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

export type Read<T> = { value: T; error?: undefined } | { error: string; value?: undefined }

// Trimmed text up to max characters. Blank is null, or an error when the
// field is required.
export function readText(value: unknown, opts: { label: string; max: number; required?: boolean }): Read<string | null> {
  if (value === undefined || value === null) {
    return opts.required ? { error: `${opts.label} is required` } : { value: null }
  }
  if (typeof value !== "string") return { error: `${opts.label} must be text` }
  const text = value.trim()
  if (!text) return opts.required ? { error: `${opts.label} is required` } : { value: null }
  if (text.length > opts.max) return { error: `${opts.label} must be ${opts.max} characters or fewer` }
  return { value: text }
}

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/

// A Decimal(12, 2) amount as the exact text Prisma stores, so nothing is
// rounded through a float. Blank or null clears it.
export function readExpectedValue(value: unknown): Read<string | null> {
  if (value === undefined || value === null || value === "") return { value: null }
  if (typeof value === "number" && !Number.isFinite(value)) return { error: EXPECTED_VALUE_MESSAGE }
  if (typeof value !== "number" && typeof value !== "string") return { error: EXPECTED_VALUE_MESSAGE }
  const text = String(value).trim()
  return MONEY_PATTERN.test(text) ? { value: text } : { error: EXPECTED_VALUE_MESSAGE }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// A date (YYYY-MM-DD, stored as midnight UTC like the date input's other
// fields) or a full ISO date and time. Blank or null clears it.
export function readDate(value: unknown, message = CLOSE_DATE_MESSAGE): Read<Date | null> {
  if (value === undefined || value === null || value === "") return { value: null }
  if (typeof value !== "string") return { error: message }
  const text = value.trim()
  const date = new Date(DATE_ONLY.test(text) ? `${text}T00:00:00.000Z` : text)
  if (Number.isNaN(date.getTime())) return { error: message }
  // new Date rolls 2026-02-31 over to March; refuse it instead
  if (DATE_ONLY.test(text) && date.toISOString().slice(0, 10) !== text) return { error: message }
  return { value: date }
}

export function isWinProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
}

// An id from a body that may be cleared: a string, or null for blank
export function readOptionalId(value: unknown): Read<string | null> {
  if (value === undefined || value === null || value === "") return { value: null }
  return typeof value === "string" ? { value } : { error: "invalid" }
}

// ─── Delete and change blocks (409) ─────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Why an opportunity can't be deleted, or null when nothing links to it
export function linkedRecordsMessage(counts: { quotes: number; salesOrders: number; purchaseOrders: number }): string | null {
  const parts = [
    counts.quotes > 0 ? plural(counts.quotes, "quote", "quotes") : null,
    counts.salesOrders > 0 ? plural(counts.salesOrders, "sales order", "sales orders") : null,
    counts.purchaseOrders > 0 ? plural(counts.purchaseOrders, "purchase order", "purchase orders") : null,
  ].filter((p): p is string => !!p)
  if (parts.length === 0) return null
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
  return `This opportunity is linked to ${list}, so it can't be deleted. Remove those links first.`
}

// count is null when the database refused the delete and no count was taken
export function stageInUseMessage(count: number | null): string {
  return `This stage is used by ${count === null ? "opportunities" : plural(count, "opportunity", "opportunities")}, so it can't be deleted. Move them to another stage first.`
}

export function lastStageMessage(category: OpportunityStageCategory, action: "deleted" | "moved"): string {
  const label = CATEGORY_LABELS[category]
  const what = action === "deleted" ? "it can't be deleted" : "its category can't be changed"
  return `This is the only ${label} stage, so ${what}. Every company needs at least one Open, one Won, and one Lost stage.`
}

export const QUOTE_SENT_STAGE_DELETE_MESSAGE =
  "This is the stage a sent quote moves its opportunity to, so it can't be deleted. Choose another stage in Opportunity Settings first."
export const QUOTE_SENT_STAGE_CATEGORY_MESSAGE =
  "This is the stage a sent quote moves its opportunity to, so it must stay Open. Choose another stage in Opportunity Settings first."

export function typeInUseMessage(count: number | null): string {
  return `This type is used by ${count === null ? "opportunities" : plural(count, "opportunity", "opportunities")}, so it can't be deleted.`
}

// True for a Prisma error with this code, for example P2003 when a row
// another row still points at is deleted
export function isPrismaError(err: unknown, code: string): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === code
}
