import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, type AccessContext } from "@/lib/api-access"
import {
  assertRefs,
  loadClientMainLocationId,
  mayAssignTicketTo,
  mayUseTicketTeam,
  ticketStatusWhere,
  ticketWhere,
  type BodyRefs,
} from "@/lib/scoped-loaders"
import { notifyTicketAssignee } from "@/lib/ticket-notifications"
import { planTeamPerson, type TeamPersonRules } from "@/lib/team-person-plan"
import { readOptionalId, readText } from "@/lib/opportunity-rules"
import {
  ASSIGNEE_NOT_IN_TEAM_MESSAGE,
  CONTACT_NEEDS_CLIENT_MESSAGE,
  LOCATION_NEEDS_CLIENT_MESSAGE,
  TEAM_CHANGE_ASSIGNEE_MESSAGE,
  TICKET_SELF_ASSIGN_ONLY_MESSAGE,
  TICKET_TEAM_NOT_MEMBER_MESSAGE,
  TICKET_TITLE_MAX,
  ticketStatusChangeData,
} from "@/lib/ticket-rules"
import { ticketDetailSelect } from "@/lib/ticket-selects"
import { recordTimelineActions } from "@/lib/timeline"
import { ticketChangeActions, ticketTimelineSnapshotSelect } from "@/lib/ticket-timeline"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { ticketFieldAudits } from "@/lib/ticket-audit"
import type { NoteStageChange, TimelineAction } from "@/lib/timeline-actions"
import type { Prisma, TicketStatusCategory } from "@/generated/prisma"

// Changing a ticket's fields, shared by PATCH /api/tickets/[id] and the
// audit log's undo, like src/lib/opportunity-update.ts: planTicketUpdate
// checks the body (the assignee and team rules, the contact and location
// belonging to the client, type, priority, and status of the company) and
// works out the write; applyTicketUpdate saves it with its timeline actions
// and audit entries in the caller's transaction.

const isBlank = (value: unknown) => value === undefined || value === null || value === ""

// What planTicketUpdate needs to know about the ticket as it is
export const ticketUpdateExistingSelect = {
  id: true,
  clientId: true,
  contactId: true,
  teamId: true,
  assigneeId: true,
  statusId: true,
  resolvedAt: true,
  closedAt: true,
  status: { select: { id: true, category: true } },
} satisfies Prisma.TicketSelect

export type TicketUpdateExisting = Prisma.TicketGetPayload<{ select: typeof ticketUpdateExistingSelect }>

export type TicketUpdatePlan = { data: Prisma.TicketUncheckedUpdateInput; response?: undefined } | { response: NextResponse; data?: undefined }

// The assignee and team rules (planTeamPerson, shared with opportunities):
// the assignee is unassigned, the user themselves, or, with tickets.assign,
// any member of the ticket's team; a new team is one the user belongs to,
// or any with tickets.assign or tickets.viewAll
function ticketTeamAssigneeRules(ctx: AccessContext): TeamPersonRules {
  return {
    personKey: "assigneeId",
    mayUseTeam: (actorInTeam) => mayUseTicketTeam(ctx, actorInTeam),
    mayAssign: (assigneeId) => mayAssignTicketTo(ctx, assigneeId),
    messages: {
      teamNotMember: TICKET_TEAM_NOT_MEMBER_MESSAGE,
      assignNotAllowed: TICKET_SELF_ASSIGN_ONLY_MESSAGE,
      personNotInTeam: ASSIGNEE_NOT_IN_TEAM_MESSAGE,
      teamChangePerson: TEAM_CHANGE_ASSIGNEE_MESSAGE,
    },
    personNotInTeamCode: "ASSIGNEE_NOT_IN_TEAM",
  }
}

// Checks the fields the body includes and works out the write. A refusal
// is the response the PATCH answers (400 or 403, with the plain reason).
export async function planTicketUpdate(ctx: AccessContext, existing: TicketUpdateExisting, body: Record<string, unknown>): Promise<TicketUpdatePlan> {
  const refuse = (response: NextResponse) => ({ response })
  const data: Prisma.TicketUncheckedUpdateInput = {}
  const refs: BodyRefs = {}

  if ("title" in body) {
    const title = readText(body.title, { label: "Title", max: TICKET_TITLE_MAX, required: true })
    if (title.error !== undefined) return refuse(apiError(400, title.error))
    data.title = title.value as string
  }

  const teamAssignee = await planTeamPerson(ctx, { teamId: existing.teamId, personId: existing.assigneeId }, body, ticketTeamAssigneeRules(ctx))
  if (teamAssignee.response) return refuse(teamAssignee.response)
  if (teamAssignee.teamChange) data.teamId = teamAssignee.teamChange
  if (teamAssignee.personGiven) {
    data.assigneeId = teamAssignee.personId
    refs.userId = teamAssignee.personId
  }

  // The client may be cleared. A contact and a location always belong to
  // the client (new or kept): a client change without a contact clears the
  // contact, and without a location resets it to the new client's main
  // location (none when the client is cleared).
  const clientGiven = "clientId" in body
  let clientId = existing.clientId
  if (clientGiven) {
    const client = readOptionalId(body.clientId)
    if (client.error !== undefined) return refuse(apiError(400, "Invalid client", "INVALID_REFERENCE"))
    clientId = client.value
    data.clientId = clientId
    refs.clientId = clientId
  }
  const clientChanged = clientGiven && clientId !== existing.clientId

  if ("contactId" in body) {
    const contact = readOptionalId(body.contactId)
    if (contact.error !== undefined) return refuse(apiError(400, "Invalid contact", "INVALID_REFERENCE"))
    if (contact.value && !clientId) return refuse(apiError(400, CONTACT_NEEDS_CLIENT_MESSAGE))
    data.contactId = contact.value
    refs.contactId = contact.value
    refs.clientId = clientId
  } else if (clientChanged) {
    data.contactId = null
  }

  const locationGiven = "clientLocationId" in body
  if (locationGiven) {
    const location = readOptionalId(body.clientLocationId)
    if (location.error !== undefined) return refuse(apiError(400, "Invalid location", "INVALID_REFERENCE"))
    if (location.value && !clientId) return refuse(apiError(400, LOCATION_NEEDS_CLIENT_MESSAGE))
    data.clientLocationId = location.value
    refs.clientLocationId = location.value
    refs.clientId = clientId
  }

  // Type, priority, and status are required: they can be changed, never cleared
  if ("typeId" in body) {
    if (isBlank(body.typeId)) return refuse(apiError(400, "A type is required"))
    data.typeId = body.typeId as string
    refs.ticketTypeId = body.typeId
  }
  if ("priorityId" in body) {
    if (isBlank(body.priorityId)) return refuse(apiError(400, "A priority is required"))
    data.priorityId = body.priorityId as string
    refs.ticketPriorityId = body.priorityId
  }
  if ("statusId" in body) {
    if (isBlank(body.statusId)) return refuse(apiError(400, "A status is required"))
    refs.ticketStatusId = body.statusId
  }

  const invalid = await assertRefs(ctx, refs)
  if (invalid) return refuse(invalid)

  // The assignee (new, or kept through a team change) must be in the team
  const notInTeam = teamAssignee.checkMembership()
  if (notInTeam) return refuse(notInTeam)

  if (clientChanged && !locationGiven) {
    data.clientLocationId = clientId ? await loadClientMainLocationId(ctx, clientId) : null
  }

  // Moving to another status stamps statusChangedAt and sets or clears
  // resolvedAt and closedAt by category
  if ("statusId" in body) {
    const status = await prisma.ticketStatus.findFirst({ where: ticketStatusWhere(ctx, body.statusId as string), select: { id: true, category: true } })
    if (!status) return refuse(apiError(400, "Invalid status", "INVALID_REFERENCE"))
    Object.assign(data, ticketStatusChangeData(existing.status, status, existing, new Date()))
  }

  return { data }
}

// Moves a ticket to another status inside the caller's transaction (a note,
// an email, or the auto close job), with the same timestamps as the PATCH
// (ticketStatusChangeData). Returns the move, names and categories
// included, or null when the ticket is already in that status. The caller
// records it (on the note or email entry, or as a status_changed action).
export async function moveTicketStatus(
  tx: Pick<Prisma.TransactionClient, "ticket">,
  ctx: Pick<AccessContext, "companyId">,
  ticketId: string,
  to: { id: string; name: string; category: TicketStatusCategory },
  now: Date
): Promise<NoteStageChange | null> {
  const before = await tx.ticket.findFirstOrThrow({
    where: ticketWhere(ctx, ticketId),
    select: { resolvedAt: true, closedAt: true, status: { select: { id: true, name: true, category: true } } },
  })
  const change = ticketStatusChangeData(before.status, to, before, now)
  if (!("statusId" in change)) return null
  await tx.ticket.update({ where: ticketWhere(ctx, ticketId), data: change, select: { id: true } })
  return { from: before.status, to }
}

type UpdateDb = Pick<Prisma.TransactionClient, "ticket" | "timelineEntry" | "auditLogEntry" | "user" | "notification">
export type SavedTicket = Prisma.TicketGetPayload<{ select: typeof ticketDetailSelect }>

// Saves a planned write inside the caller's transaction, the same steps as
// applyOpportunityUpdate: the before values are read again right before the
// write, and each field that actually changed gets one timeline ACTION
// entry and one audit entry (by default field_changed; auditEntries lets
// the undo write its own). Nothing is recorded when nothing changed.
export async function applyTicketUpdate(
  tx: UpdateDb,
  ctx: Pick<AccessContext, "companyId" | "userId">,
  ticketId: string,
  data: Prisma.TicketUncheckedUpdateInput,
  auditEntries: (saved: SavedTicket, actions: TimelineAction[]) => AuditEntryInput[] = ticketFieldAudits
): Promise<{ saved: SavedTicket; actions: TimelineAction[] }> {
  const before = await tx.ticket.findFirstOrThrow({ where: ticketWhere(ctx, ticketId), select: ticketTimelineSnapshotSelect })
  const saved = await tx.ticket.update({ where: ticketWhere(ctx, ticketId), data, select: ticketDetailSelect })
  const actions = ticketChangeActions(before, saved)
  const at = new Date()
  await recordTimelineActions(tx, { companyId: ctx.companyId, authorId: ctx.userId, subject: { ticketId }, actions, at })
  await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: auditEntries(saved, actions), at })
  // A new assignee hears about it, unless they made the change themselves
  await notifyTicketAssignee(tx, {
    companyId: ctx.companyId,
    ticket: saved,
    from: before.assignee?.id ?? null,
    to: saved.assignee?.id ?? null,
    actorId: ctx.userId,
  })
  return { saved, actions }
}
