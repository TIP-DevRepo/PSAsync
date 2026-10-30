// The audit log's keys, labels, and rules that both the server and the
// screens use: record types, actions, fields, how a stored value reads, and
// whether a change can be undone (undoBlockReason, the one rule the undo
// route and the list's canUndo share). No React and no database imports.
//
// Values in before and after are stored with names next to ids, so an entry
// reads correctly after a rename or delete:
//   refs (client, contact, location, team, owner, stage, type): { id, name } or null
//   title: text; expectedValue: decimal text ("1250.5"); dates: YYYY-MM-DD
//   closedAt: an ISO date and time, or null
//   notes: { entryId, text } (the note's plain text)
//   attachments: { id, fileName, fileSize }
//   emails: { entryId, to, subject }

export const AUDIT_RECORD_TYPES = ["OPPORTUNITY", "TICKET", "QUOTE", "SALES_ORDER", "PURCHASE_ORDER"] as const
export type AuditRecordTypeKey = (typeof AUDIT_RECORD_TYPES)[number]

export const AUDIT_RECORD_TYPE_LABELS: Record<AuditRecordTypeKey, string> = {
  OPPORTUNITY: "Opportunity",
  TICKET: "Ticket",
  QUOTE: "Quote",
  SALES_ORDER: "Sales order",
  PURCHASE_ORDER: "Purchase order",
}

export function isAuditRecordType(value: unknown): value is AuditRecordTypeKey {
  return typeof value === "string" && (AUDIT_RECORD_TYPES as readonly string[]).includes(value)
}

export const AUDIT_ACTIONS = [
  "created",
  "field_changed",
  // closedAt following a stage whose category changed in Opportunity Settings
  "closed_date_changed",
  "deleted",
  "restored",
  "note_added",
  "note_edited",
  "note_deleted",
  "attachment_added",
  "attachment_removed",
  "email_sent",
  // A field_changed entry reversed from the audit log (undoOfId)
  "undone",
] as const
export type AuditActionKey = (typeof AUDIT_ACTIONS)[number]

// What each action reads as, in plain words
export const AUDIT_ACTION_LABELS: Record<AuditActionKey, string> = {
  created: "Created",
  field_changed: "Changed",
  closed_date_changed: "Closed date set by stage",
  deleted: "Deleted",
  restored: "Restored",
  note_added: "Note added",
  note_edited: "Note edited",
  note_deleted: "Note deleted",
  attachment_added: "Attachment added",
  attachment_removed: "Attachment removed",
  email_sent: "Email sent",
  undone: "Change undone",
}

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action
}

// The fields entries name, by their PATCH body key (so an undo can send the
// before value back through the same update rules)
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  clientId: "Client",
  contactId: "Contact",
  clientLocationId: "Location",
  teamId: "Team",
  ownerId: "Owner",
  stageId: "Stage",
  typeId: "Type",
  expectedValue: "Expected value",
  expectedCloseDate: "Expected close date",
  closedAt: "Closed date",
}

export function auditFieldLabel(field: string | null): string {
  if (!field) return "-"
  return AUDIT_FIELD_LABELS[field] ?? field
}

// The opportunity fields a field_changed entry can be undone for: every
// field the opportunity PATCH takes
export const OPPORTUNITY_UNDOABLE_FIELDS = [
  "title",
  "clientId",
  "contactId",
  "clientLocationId",
  "teamId",
  "ownerId",
  "stageId",
  "typeId",
  "expectedValue",
  "expectedCloseDate",
] as const

const REF_FIELDS = new Set(["clientId", "contactId", "clientLocationId", "teamId", "ownerId", "stageId", "typeId"])

// Fields one change sets together because the update rules tie them: a
// contact must belong to the client (and a client change resets the
// location), and an owner must be in the team. Undoing one of them also
// undoes the others recorded in the same change, when they can be undone,
// so the rules see the whole earlier state at once.
export const LINKED_UNDO_FIELDS: readonly (readonly string[])[] = [
  ["clientId", "contactId", "clientLocationId"],
  ["teamId", "ownerId"],
]

export function linkedUndoFields(field: string): string[] {
  return LINKED_UNDO_FIELDS.find((group) => group.includes(field))?.filter((f) => f !== field) ?? []
}

// ─── Undo ───────────────────────────────────────────────────────────────────

export interface UndoCandidate {
  action: string
  recordType: string
  field: string | null
  undoneAt: Date | string | null
}

export interface UndoContext {
  // The record is deleted (or gone)
  recordDeleted: boolean
  // A later field_changed or undone entry exists for the same record and field
  changedSince: boolean
}

export const UNDO_MESSAGES = {
  notFieldChange: "Only field changes can be undone",
  notUndoable: "This change can't be undone",
  alreadyUndone: "This change was already undone",
  recordDeleted: "This opportunity is deleted. Restore it first.",
  changedSince: "This field has changed since. Only its latest change can be undone.",
} as const

// Why an entry can't be undone, or null when it can. The undo route and the
// list's canUndo both use this.
export function undoBlockReason(entry: UndoCandidate, ctx: UndoContext): string | null {
  if (entry.action !== "field_changed") return UNDO_MESSAGES.notFieldChange
  if (entry.recordType !== "OPPORTUNITY" || !entry.field || !(OPPORTUNITY_UNDOABLE_FIELDS as readonly string[]).includes(entry.field)) {
    return UNDO_MESSAGES.notUndoable
  }
  if (entry.undoneAt) return UNDO_MESSAGES.alreadyUndone
  if (ctx.recordDeleted) return UNDO_MESSAGES.recordDeleted
  if (ctx.changedSince) return UNDO_MESSAGES.changedSince
  return null
}

export function canUndoEntry(entry: UndoCandidate, ctx: UndoContext): boolean {
  return undoBlockReason(entry, ctx) === null
}

// The PATCH body value that puts a field back to a stored value: a ref's
// id (null for none), or the text as stored
export function undoBodyValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (REF_FIELDS.has(field)) {
    const id = typeof value === "object" ? (value as { id?: unknown }).id : null
    return typeof id === "string" ? id : null
  }
  return typeof value === "string" ? value : null
}

// What the rules said when an undo was refused, in words about the old
// value rather than the request
export function undoRefusalMessage(error: string, code?: string): string {
  if (code === "OWNER_NOT_IN_TEAM") return "This owner is no longer in the team"
  const byError: Record<string, string> = {
    "Invalid client": "This client no longer exists",
    "Invalid contact": "This contact no longer belongs to the client",
    "Invalid location": "This location no longer belongs to the client",
    "Invalid user": "This user is no longer active",
    "Invalid team": "This team no longer exists",
    "Invalid stage": "This stage no longer exists",
    "Invalid opportunity type": "This type no longer exists",
  }
  return byError[error] ?? error
}

// ─── Reading values ─────────────────────────────────────────────────────────

const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null

function fileSizeText(bytes: unknown): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function money(value: string): string {
  const n = Number(value)
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value
}

// "Nothing" for a field: Unassigned for the owner, None for the type
function noneText(field: string | null): string {
  if (field === "ownerId") return "Unassigned"
  if (field === "typeId") return "None"
  if (field === "closedAt") return "Not closed"
  return "-"
}

// One stored before or after value as plain text, for the table. Reads
// whatever is stored without trusting its shape.
export function auditValueText(field: string | null, value: unknown): string {
  if (value === null || value === undefined || value === "") return noneText(field)
  if (typeof value === "string") {
    if (field === "expectedValue") return money(value)
    if (field === "expectedCloseDate" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: "UTC" })
    }
    if (field === "closedAt") {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
    }
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  const o = obj(value)
  if (!o) return JSON.stringify(value)
  if (typeof o.text === "string") return o.text || "(no text)"
  if (typeof o.fileName === "string") {
    const size = fileSizeText(o.fileSize)
    return size ? `${o.fileName} (${size})` : o.fileName
  }
  if (typeof o.subject === "string" || Array.isArray(o.to)) {
    const to = Array.isArray(o.to) ? o.to.filter((t) => typeof t === "string").join(", ") : ""
    return [to ? `To: ${to}` : null, typeof o.subject === "string" ? `Subject: ${o.subject}` : null].filter(Boolean).join(". ")
  }
  if (typeof o.number === "string" && typeof o.title === "string") return `${o.number} ${o.title}`
  if (typeof o.name === "string") return o.name || noneText(field)
  return JSON.stringify(value)
}

// The plain text of sanitized note HTML: block ends become line breaks,
// tags go, and the common entities are read back
export function plainTextFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ─── Server filters ─────────────────────────────────────────────────────────

// The action keys whose label or key contains the text, ignoring case
export function actionKeysMatching(text: string): string[] {
  const wanted = text.trim().toLowerCase()
  return AUDIT_ACTIONS.filter((key) => key.includes(wanted) || AUDIT_ACTION_LABELS[key].toLowerCase().includes(wanted))
}

// The field keys whose label or key contains the text, ignoring case
export function fieldKeysMatching(text: string): string[] {
  const wanted = text.trim().toLowerCase()
  return Object.entries(AUDIT_FIELD_LABELS)
    .filter(([key, label]) => key.toLowerCase().includes(wanted) || label.toLowerCase().includes(wanted))
    .map(([key]) => key)
}

// Where a record's page is, for the Record column's link (opened in a new
// tab), or null for record types that have no page yet
export function auditRecordHref(recordType: string, recordId: string): string | null {
  return recordType === "OPPORTUNITY" ? `/dashboard/opportunities/${recordId}` : null
}
