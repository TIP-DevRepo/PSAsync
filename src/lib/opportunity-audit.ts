import type { AuditEntryInput } from "@/lib/audit-log"
import { plainTextFromHtml } from "@/lib/audit-values"
import type { OpportunitySnapshot } from "@/lib/opportunity-timeline"
import type { TimelineAction, TimelineActionKey, TimelineRef } from "@/lib/timeline-actions"

// Which audit entries an opportunity change writes. Pure: the routes write
// what these return with recordAudit in the same transaction as the change.
// Field changes come from the same comparison the timeline uses
// (opportunityChangeActions), so the two always agree, and nothing is
// recorded for a change that changes nothing.

export interface OpportunityAuditRecord {
  id: string
  number: string
  title: string
}

// The record label stored with every entry, for example "OPP-2026-0007 New laptops"
export const opportunityAuditLabel = (o: Pick<OpportunityAuditRecord, "number" | "title">) => `${o.number} ${o.title}`

function entry(o: OpportunityAuditRecord, rest: Omit<AuditEntryInput, "recordType" | "recordId" | "recordLabel">): AuditEntryInput {
  return { recordType: "OPPORTUNITY", recordId: o.id, recordLabel: opportunityAuditLabel(o), ...rest }
}

const ref = (r: { id: string; name: string } | null): TimelineRef | null => (r ? { id: r.id, name: r.name } : null)

export function opportunityCreatedAudit(o: OpportunityAuditRecord & OpportunitySnapshot): AuditEntryInput {
  return entry(o, {
    action: "created",
    after: {
      number: o.number,
      title: o.title,
      client: ref(o.client),
      contact: { id: o.contact.id, name: `${o.contact.firstName} ${o.contact.lastName}`.trim() },
      team: ref(o.team),
      owner: ref(o.owner),
      stage: ref(o.stage),
    },
  })
}

// The field each timeline action is about (its PATCH body key)
export const TIMELINE_ACTION_FIELDS: Partial<Record<TimelineActionKey, string>> = {
  stage_changed: "stageId",
  team_changed: "teamId",
  owner_changed: "ownerId",
  type_changed: "typeId",
  client_changed: "clientId",
  contact_changed: "contactId",
  location_changed: "clientLocationId",
  title_changed: "title",
  expected_value_changed: "expectedValue",
  expected_close_date_changed: "expectedCloseDate",
}

// One field_changed entry per field the timeline actions say changed, with
// the same before and after values (names next to ids)
export function opportunityFieldAudits(o: OpportunityAuditRecord, actions: TimelineAction[]): AuditEntryInput[] {
  const entries: AuditEntryInput[] = []
  for (const a of actions) {
    const field = TIMELINE_ACTION_FIELDS[a.action]
    if (!field || !("from" in a.data)) continue
    entries.push(entry(o, { action: "field_changed", field, before: a.data.from, after: a.data.to }))
  }
  return entries
}

// A stage moved by a note, an action button, or an email (recorded on the
// timeline as part of that note or email, never as its own action)
export function opportunityStageAudit(o: OpportunityAuditRecord, from: { id: string; name: string }, to: { id: string; name: string }): AuditEntryInput {
  return entry(o, { action: "field_changed", field: "stageId", before: ref(from), after: ref(to) })
}

// closedAt following its stage's category change (Opportunity Settings).
// Never undone on its own: it follows the stage.
export function opportunityClosedDateAudit(o: OpportunityAuditRecord, before: Date | null, after: Date | null): AuditEntryInput {
  return entry(o, { action: "closed_date_changed", field: "closedAt", before: before?.toISOString() ?? null, after: after?.toISOString() ?? null })
}

const noteValue = (entryId: string, html: string | null) => (html === null ? null : { entryId, text: plainTextFromHtml(html) })

export function opportunityNoteAudit(
  o: OpportunityAuditRecord,
  change: "added" | "edited" | "deleted",
  note: { entryId: string; before?: string | null; after?: string | null }
): AuditEntryInput {
  const action = change === "added" ? "note_added" : change === "edited" ? "note_edited" : "note_deleted"
  return entry(o, { action, before: noteValue(note.entryId, note.before ?? null), after: noteValue(note.entryId, note.after ?? null) })
}

export function opportunityAttachmentAudit(
  o: OpportunityAuditRecord,
  change: "added" | "removed",
  attachment: { id: string; fileName: string; fileSize: number | null }
): AuditEntryInput {
  const value = { id: attachment.id, fileName: attachment.fileName, fileSize: attachment.fileSize }
  return change === "added" ? entry(o, { action: "attachment_added", after: value }) : entry(o, { action: "attachment_removed", before: value })
}

export function opportunityEmailAudit(o: OpportunityAuditRecord, email: { entryId: string; to: string[]; subject: string }): AuditEntryInput {
  return entry(o, { action: "email_sent", after: { entryId: email.entryId, to: email.to, subject: email.subject } })
}

export function opportunityDeletedAudit(o: OpportunityAuditRecord): AuditEntryInput {
  return entry(o, { action: "deleted" })
}

export function opportunityRestoredAudit(o: OpportunityAuditRecord): AuditEntryInput {
  return entry(o, { action: "restored" })
}

// An undo of a field_changed entry: the value it moved away from and the
// one it put back
export function opportunityUndoneAudit(o: OpportunityAuditRecord, undoOfId: string, field: string, before: unknown, after: unknown): AuditEntryInput {
  return entry(o, { action: "undone", field, before, after, undoOfId })
}
