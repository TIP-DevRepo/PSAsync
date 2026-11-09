import type { Prisma, PrismaClient, TicketSource } from "@/generated/prisma"
import { takeRecordNumber } from "@/lib/record-number"
import { ticketDetailSelect } from "@/lib/ticket-selects"
import { ROUND_ROBIN_REASON, statusTimestamps, type StatusRef } from "@/lib/ticket-rules"
import { initialNoteAuthorId, initialNoteHtml, recordTimelineActions, writeInitialNote, type InitialNote } from "@/lib/timeline"
import { ref, ticketCreatedAction } from "@/lib/ticket-timeline"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { ticketAssigneeAudit, ticketCreatedAudit } from "@/lib/ticket-audit"
import { nextRoundRobinAssignee } from "@/lib/round-robin"
import type { TimelineAction } from "@/lib/timeline-actions"
import { notifyTicketAssignee } from "@/lib/ticket-notifications"
import { prefixedTitle } from "@/lib/record-title"

// Creating a ticket, shared by POST /api/tickets (a person) and the later
// mailbox and NinjaOne phases (the system). Every ticket starts with a
// note: a person's own initial note, or a note the system writes. The
// caller has already checked access and every id (assertRefs), and that a
// named assignee is a member of the team.

export interface NewTicket {
  companyId: string
  // The user the ticket is recorded as created by; null for the system
  createdById: string | null
  title: string
  clientId: string | null
  contactId: string | null
  clientLocationId: string | null
  teamId: string
  // Null is unassigned, the default for new records. Round robin may then
  // assign it (the team's roundRobinEnabled).
  assigneeId: string | null
  typeId: string
  priorityId: string
  status: StatusRef
  source: TicketSource
  initialNote: InitialNote
}

type CreateDb = Pick<PrismaClient, "$transaction">

// Creates the ticket, its "created" timeline and audit entries, a round
// robin assignment when it applies, and the initial note a moment after
// (so the note reads first, newest first), all in one transaction that also
// takes the number. The created entries and the note are by the person, or
// by the system (no author) for a system note; a round robin assignment is
// always by the system.
export async function createTicket(db: CreateDb, input: NewTicket, now = new Date()) {
  const noteHtml = initialNoteHtml(input.initialNote)
  return db.$transaction((tx) => createTicketIn(tx, input, noteHtml, now))
}

// The member round robin gives a new unassigned ticket in this team, or
// null when the team doesn't use round robin or has no active member. The
// team's row is locked first (FOR UPDATE), so two tickets created at the
// same moment in the same team take turns instead of both going to the
// same person, and roundRobinLastUserId moves on in the same transaction.
export async function takeRoundRobinAssignee(tx: Prisma.TransactionClient, companyId: string, teamId: string): Promise<{ id: string; name: string } | null> {
  await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} AND "companyId" = ${companyId} FOR UPDATE`
  const team = await tx.team.findFirst({
    where: { id: teamId, companyId },
    select: {
      roundRobinEnabled: true,
      roundRobinLastUser: { select: { id: true, name: true } },
      members: { select: { user: { select: { id: true, name: true, active: true } } } },
    },
  })
  if (!team?.roundRobinEnabled) return null
  const nextId = nextRoundRobinAssignee(
    team.members.map((m) => m.user),
    team.roundRobinLastUser
  )
  if (!nextId) return null
  await tx.team.update({ where: { id: teamId }, data: { roundRobinLastUserId: nextId }, select: { id: true } })
  const next = team.members.find((m) => m.user.id === nextId)?.user
  return next ? { id: next.id, name: next.name } : null
}

async function createTicketIn(tx: Prisma.TransactionClient, input: NewTicket, noteHtml: string, now: Date) {
  const authorId = initialNoteAuthorId(input.initialNote)
  // The prefix is read inside the transaction, with the number
  const settings = await tx.ticketSettings.findUnique({ where: { companyId: input.companyId }, select: { prefix: true } })
  if (!settings) throw new Error("The company has no ticket settings; run ensureTicketDefaults first")
  const number = await takeRecordNumber(tx, input.companyId, "ticket", settings.prefix, now)

  const roundRobin = input.assigneeId === null ? await takeRoundRobinAssignee(tx, input.companyId, input.teamId) : null
  // The client's prefix goes in front of the title (src/lib/record-title.ts)
  const client = input.clientId ? await tx.client.findFirst({ where: { id: input.clientId, companyId: input.companyId }, select: { prefix: true } }) : null
  const timestamps = statusTimestamps(null, input.status.category, { resolvedAt: null, closedAt: null }, now)

  const created = await tx.ticket.create({
    data: {
      companyId: input.companyId,
      number,
      title: prefixedTitle(input.title, client?.prefix),
      clientId: input.clientId,
      contactId: input.contactId,
      clientLocationId: input.clientLocationId,
      teamId: input.teamId,
      assigneeId: input.assigneeId ?? roundRobin?.id ?? null,
      typeId: input.typeId,
      priorityId: input.priorityId,
      statusId: input.status.id,
      source: input.source,
      statusChangedAt: now,
      ...timestamps,
      createdById: input.createdById,
    },
    select: ticketDetailSelect,
  })

  const subject = { ticketId: created.id }
  // The created entries describe the ticket as the person made it
  // (unassigned when round robin assigned it), then the assignment follows
  const createdView = roundRobin ? { ...created, assignee: null } : created
  await recordTimelineActions(tx, { companyId: input.companyId, authorId, subject, actions: [ticketCreatedAction(createdView)], at: now })
  await recordAudit(tx, { companyId: input.companyId, actorId: authorId, entries: [ticketCreatedAudit(createdView)], at: now })
  if (roundRobin) {
    const assigned: TimelineAction = { action: "assignee_changed", data: { from: null, to: ref(roundRobin), reason: ROUND_ROBIN_REASON } }
    await recordTimelineActions(tx, { companyId: input.companyId, authorId: null, subject, actions: [assigned], at: now })
    const audit: AuditEntryInput[] = [ticketAssigneeAudit(created, roundRobin)]
    await recordAudit(tx, { companyId: input.companyId, actorId: null, entries: audit, at: now })
  }
  await writeInitialNote(tx, { companyId: input.companyId, subject, authorId, html: noteHtml, createdAt: now })
  // The assignee hears about it, unless they made the ticket themselves
  await notifyTicketAssignee(tx, {
    companyId: input.companyId,
    ticket: created,
    from: null,
    to: created.assignee?.id ?? null,
    actorId: input.createdById,
    roundRobin: !!roundRobin,
  })
  return created
}
