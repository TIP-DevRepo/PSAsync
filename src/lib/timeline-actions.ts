// The ACTION entry keys a timeline records, their data shapes, and the
// sentence each one reads as. Shared by the server (which writes them) and
// the timeline component (which shows them), so no React and no database
// imports. Generic so tickets can record the same keys later.
//
// Every reference is stored with its name as well as its id, so an entry
// still reads correctly after a stage, user, or type is renamed or deleted.

export const TIMELINE_ACTIONS = [
  "created",
  "stage_changed",
  "owner_changed",
  "type_changed",
  "client_changed",
  "contact_changed",
  "title_changed",
  "expected_value_changed",
  "expected_close_date_changed",
  "attachment_added",
  "attachment_removed",
] as const

export type TimelineActionKey = (typeof TIMELINE_ACTIONS)[number]

// A record another one points at, as it was named when the entry was written
export interface TimelineRef {
  id: string
  name: string
}

// What each key's data holds. from and to are null for "nothing" (unassigned,
// no type, no value, no date).
export interface TimelineActionData {
  created: { label: string; number: string; title: string; stage: TimelineRef | null }
  stage_changed: { from: TimelineRef | null; to: TimelineRef | null }
  owner_changed: { from: TimelineRef | null; to: TimelineRef | null }
  type_changed: { from: TimelineRef | null; to: TimelineRef | null }
  client_changed: { from: TimelineRef | null; to: TimelineRef | null }
  contact_changed: { from: TimelineRef | null; to: TimelineRef | null }
  title_changed: { from: string | null; to: string | null }
  // Decimal text, for example "1250.5"
  expected_value_changed: { from: string | null; to: string | null }
  // YYYY-MM-DD
  expected_close_date_changed: { from: string | null; to: string | null }
  attachment_added: { attachmentId: string; fileName: string }
  attachment_removed: { attachmentId: string; fileName: string }
}

export type TimelineAction = { [K in TimelineActionKey]: { action: K; data: TimelineActionData[K] } }[TimelineActionKey]

// ─── Sentences ──────────────────────────────────────────────────────────────

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const refName = (value: unknown, none: string) => {
  const name = obj(value).name
  return typeof name === "string" && name ? name : none
}
const text = (value: unknown, none: string) => (typeof value === "string" && value ? value : none)

function money(value: unknown): string {
  if (typeof value !== "string" || !value) return "not set"
  const n = Number(value)
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value
}

function dateOnly(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "not set"
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: "UTC" })
}

// One plain sentence for an ACTION entry, for example "Stage changed from
// New to Qualified". Reads whatever data is stored without trusting its shape.
export function describeTimelineAction(action: string | null, data: unknown): string {
  const d = obj(data)
  switch (action) {
    case "created":
      return `${text(d.label, "Record")} created${typeof d.number === "string" && d.number ? ` as ${d.number}` : ""}${
        d.stage ? ` in ${refName(d.stage, "a stage")}` : ""
      }`
    case "stage_changed":
      return `Stage changed from ${refName(d.from, "none")} to ${refName(d.to, "none")}`
    case "owner_changed":
      return `Owner changed from ${refName(d.from, "Unassigned")} to ${refName(d.to, "Unassigned")}`
    case "type_changed":
      return `Type changed from ${refName(d.from, "None")} to ${refName(d.to, "None")}`
    case "client_changed":
      return `Client changed from ${refName(d.from, "none")} to ${refName(d.to, "none")}`
    case "contact_changed":
      return `Contact changed from ${refName(d.from, "none")} to ${refName(d.to, "none")}`
    case "title_changed":
      return `Title changed from "${text(d.from, "")}" to "${text(d.to, "")}"`
    case "expected_value_changed":
      return `Expected value changed from ${money(d.from)} to ${money(d.to)}`
    case "expected_close_date_changed":
      return `Expected close date changed from ${dateOnly(d.from)} to ${dateOnly(d.to)}`
    case "attachment_added":
      return `Attachment added: ${text(d.fileName, "a file")}`
    case "attachment_removed":
      return `Attachment removed: ${text(d.fileName, "a file")}`
    default:
      return "Updated"
  }
}
