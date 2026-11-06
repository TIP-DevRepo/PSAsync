import { fieldChangedEntries, type AuditEntryInput } from "@/lib/audit-log"
import { plainTextFromHtml } from "@/lib/audit-values"
import { contactRef, ref, type TicketSnapshot } from "@/lib/ticket-timeline"
import type { TimelineAction, TimelineActionKey } from "@/lib/timeline-actions"

// Which audit entries a ticket change writes (recordType TICKET), the same
// set opportunities record (src/lib/opportunity-audit.ts). Pure: the routes
// write what these return with recordAudit in the same transaction as the
// change. Field changes come from the same comparison the timeline uses
// (ticketChangeActions), so the two always agree.

export interface TicketAuditRecord {
  id: string
  number: string
  title: string
}

// The record label stored with every entry, for example "T-2026-0007 Printer offline"
export const ticketAuditLabel = (t: Pick<TicketAuditRecord, "number" | "title">) => `${t.number} ${t.title}`

function entry(t: TicketAuditRecord, rest: Omit<AuditEntryInput, "recordType" | "recordId" | "recordLabel">): AuditEntryInput {
  return { recordType: "TICKET", recordId: t.id, recordLabel: ticketAuditLabel(t), ...rest }
}

export function ticketCreatedAudit(t: TicketAuditRecord & TicketSnapshot): AuditEntryInput {
  return entry(t, {
    action: "created",
    after: {
      number: t.number,
      title: t.title,
      client: ref(t.client),
      contact: contactRef(t.contact),
      team: ref(t.team),
      assignee: ref(t.assignee),
      type: ref(t.type),
      priority: ref(t.priority),
      status: ref(t.status),
    },
  })
}

// The field each timeline action is about (its PATCH body key)
export const TICKET_ACTION_FIELDS: Partial<Record<TimelineActionKey, string>> = {
  status_changed: "statusId",
  priority_changed: "priorityId",
  team_changed: "teamId",
  assignee_changed: "assigneeId",
  type_changed: "typeId",
  client_changed: "clientId",
  contact_changed: "contactId",
  location_changed: "clientLocationId",
  title_changed: "title",
}

export function ticketFieldAudits(t: TicketAuditRecord, actions: TimelineAction[]): AuditEntryInput[] {
  return fieldChangedEntries({ recordType: "TICKET", recordId: t.id, recordLabel: ticketAuditLabel(t) }, actions, TICKET_ACTION_FIELDS)
}

// A status moved by a note, an action button, an email, or the auto close job
export function ticketStatusAudit(t: TicketAuditRecord, from: { id: string; name: string }, to: { id: string; name: string }): AuditEntryInput {
  return entry(t, { action: "field_changed", field: "statusId", before: ref(from), after: ref(to) })
}

// The assignee round robin chose for a new ticket (by System)
export function ticketAssigneeAudit(t: TicketAuditRecord, to: { id: string; name: string }): AuditEntryInput {
  return entry(t, { action: "field_changed", field: "assigneeId", before: null, after: ref(to) })
}

const noteValue = (entryId: string, html: string | null) => (html === null ? null : { entryId, text: plainTextFromHtml(html) })

export function ticketNoteAudit(
  t: TicketAuditRecord,
  change: "added" | "edited" | "deleted",
  note: { entryId: string; before?: string | null; after?: string | null }
): AuditEntryInput {
  const action = change === "added" ? "note_added" : change === "edited" ? "note_edited" : "note_deleted"
  return entry(t, { action, before: noteValue(note.entryId, note.before ?? null), after: noteValue(note.entryId, note.after ?? null) })
}

export function ticketAttachmentAudit(t: TicketAuditRecord, change: "added" | "removed", attachment: { id: string; fileName: string; fileSize: number | null }): AuditEntryInput {
  const value = { id: attachment.id, fileName: attachment.fileName, fileSize: attachment.fileSize }
  return change === "added" ? entry(t, { action: "attachment_added", after: value }) : entry(t, { action: "attachment_removed", before: value })
}

export function ticketEmailAudit(t: TicketAuditRecord, email: { entryId: string; to: string[]; subject: string }): AuditEntryInput {
  return entry(t, { action: "email_sent", after: { entryId: email.entryId, to: email.to, subject: email.subject } })
}

export function ticketDeletedAudit(t: TicketAuditRecord): AuditEntryInput {
  return entry(t, { action: "deleted" })
}

export function ticketRestoredAudit(t: TicketAuditRecord): AuditEntryInput {
  return entry(t, { action: "restored" })
}

export function ticketUndoneAudit(t: TicketAuditRecord, undoOfId: string, field: string, before: unknown, after: unknown): AuditEntryInput {
  return entry(t, { action: "undone", field, before, after, undoOfId })
}
