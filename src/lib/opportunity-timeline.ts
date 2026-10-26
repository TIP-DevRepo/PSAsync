import type { Prisma } from "@/generated/prisma"
import type { TimelineAction, TimelineRef } from "@/lib/timeline-actions"

// Which ACTION entries an opportunity change records. Pure: the routes read
// the opportunity before and after the change and write what this returns
// with recordTimelineActions in the same transaction. No database imports.

// What a change is compared on, with the names the entries store
export const opportunityTimelineSnapshotSelect = {
  id: true,
  number: true,
  title: true,
  expectedValue: true,
  expectedCloseDate: true,
  client: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  owner: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true } },
  type: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySelect

// The shape both sides of a change share (the snapshot select, or the
// detail select a PATCH returns). expectedValue is a Prisma Decimal, or its
// text.
export interface OpportunitySnapshot {
  number: string
  title: string
  expectedValue: { toString(): string } | string | null
  expectedCloseDate: Date | null
  client: { id: string; name: string }
  contact: { id: string; firstName: string; lastName: string }
  owner: { id: string; name: string } | null
  stage: { id: string; name: string }
  type: { id: string; name: string } | null
}

const ref = (r: { id: string; name: string } | null): TimelineRef | null => (r ? { id: r.id, name: r.name } : null)
const contactRef = (c: OpportunitySnapshot["contact"]): TimelineRef => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() })
const valueText = (v: OpportunitySnapshot["expectedValue"]) => (v === null ? null : String(v))
const dateText = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export function opportunityCreatedAction(o: OpportunitySnapshot): TimelineAction {
  return { action: "created", data: { label: "Opportunity", number: o.number, title: o.title, stage: ref(o.stage) } }
}

// One entry per field that actually changed, in a fixed order. Nothing for
// a change that leaves every field as it was.
export function opportunityChangeActions(before: OpportunitySnapshot, after: OpportunitySnapshot): TimelineAction[] {
  const actions: TimelineAction[] = []
  if (before.stage.id !== after.stage.id) actions.push({ action: "stage_changed", data: { from: ref(before.stage), to: ref(after.stage) } })
  if ((before.owner?.id ?? null) !== (after.owner?.id ?? null)) {
    actions.push({ action: "owner_changed", data: { from: ref(before.owner), to: ref(after.owner) } })
  }
  if ((before.type?.id ?? null) !== (after.type?.id ?? null)) actions.push({ action: "type_changed", data: { from: ref(before.type), to: ref(after.type) } })
  if (before.client.id !== after.client.id) actions.push({ action: "client_changed", data: { from: ref(before.client), to: ref(after.client) } })
  if (before.contact.id !== after.contact.id) {
    actions.push({ action: "contact_changed", data: { from: contactRef(before.contact), to: contactRef(after.contact) } })
  }
  if (before.title !== after.title) actions.push({ action: "title_changed", data: { from: before.title, to: after.title } })
  if (valueText(before.expectedValue) !== valueText(after.expectedValue)) {
    actions.push({ action: "expected_value_changed", data: { from: valueText(before.expectedValue), to: valueText(after.expectedValue) } })
  }
  if (dateText(before.expectedCloseDate) !== dateText(after.expectedCloseDate)) {
    actions.push({ action: "expected_close_date_changed", data: { from: dateText(before.expectedCloseDate), to: dateText(after.expectedCloseDate) } })
  }
  return actions
}

export function attachmentAction(change: "added" | "removed", attachment: { id: string; fileName: string }): TimelineAction {
  const data = { attachmentId: attachment.id, fileName: attachment.fileName }
  return change === "added" ? { action: "attachment_added", data } : { action: "attachment_removed", data }
}
