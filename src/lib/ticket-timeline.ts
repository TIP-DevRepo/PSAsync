import type { Prisma } from "@/generated/prisma"
import type { TimelineAction, TimelineRef } from "@/lib/timeline-actions"

// Which ACTION entries a ticket change records, like
// src/lib/opportunity-timeline.ts. Pure: the routes read the ticket before
// and after the change and write what this returns with
// recordTimelineActions in the same transaction. No database imports.

// What a change is compared on, with the names the entries store
export const ticketTimelineSnapshotSelect = {
  id: true,
  number: true,
  title: true,
  client: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  clientLocation: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  type: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true } },
  status: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect

export interface TicketSnapshot {
  number: string
  title: string
  client: { id: string; name: string } | null
  contact: { id: string; firstName: string; lastName: string } | null
  clientLocation: { id: string; name: string } | null
  team: { id: string; name: string }
  assignee: { id: string; name: string } | null
  type: { id: string; name: string }
  priority: { id: string; name: string }
  status: { id: string; name: string }
}

export const ref = (r: { id: string; name: string } | null): TimelineRef | null => (r ? { id: r.id, name: r.name } : null)
export const contactRef = (c: TicketSnapshot["contact"]): TimelineRef | null => (c ? { id: c.id, name: `${c.firstName} ${c.lastName}`.trim() } : null)

export function ticketCreatedAction(t: TicketSnapshot): TimelineAction {
  return { action: "created", data: { label: "Ticket", number: t.number, title: t.title, status: ref(t.status) } }
}

// One entry per field that actually changed, in a fixed order. Nothing for
// a change that leaves every field as it was.
export function ticketChangeActions(before: TicketSnapshot, after: TicketSnapshot): TimelineAction[] {
  const actions: TimelineAction[] = []
  const id = (r: { id: string } | null) => r?.id ?? null
  if (before.status.id !== after.status.id) actions.push({ action: "status_changed", data: { from: ref(before.status), to: ref(after.status) } })
  if (before.priority.id !== after.priority.id) actions.push({ action: "priority_changed", data: { from: ref(before.priority), to: ref(after.priority) } })
  if (before.team.id !== after.team.id) actions.push({ action: "team_changed", data: { from: ref(before.team), to: ref(after.team) } })
  if (id(before.assignee) !== id(after.assignee)) actions.push({ action: "assignee_changed", data: { from: ref(before.assignee), to: ref(after.assignee) } })
  if (before.type.id !== after.type.id) actions.push({ action: "type_changed", data: { from: ref(before.type), to: ref(after.type) } })
  if (id(before.client) !== id(after.client)) actions.push({ action: "client_changed", data: { from: ref(before.client), to: ref(after.client) } })
  if (id(before.contact) !== id(after.contact)) actions.push({ action: "contact_changed", data: { from: contactRef(before.contact), to: contactRef(after.contact) } })
  if (id(before.clientLocation) !== id(after.clientLocation)) {
    actions.push({ action: "location_changed", data: { from: ref(before.clientLocation), to: ref(after.clientLocation) } })
  }
  if (before.title !== after.title) actions.push({ action: "title_changed", data: { from: before.title, to: after.title } })
  return actions
}
