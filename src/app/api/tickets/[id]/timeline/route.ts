import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadTicketTimelineEntry, loadViewableTicket, ticketTimelineWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { INVALID_BODY_MESSAGE, readJsonObject } from "@/lib/opportunity-rules"
import {
  INVALID_CURSOR_MESSAGE,
  NOTE_EMPTY_MESSAGE,
  readNoteBody,
  readOptionalNoteBody,
  readTimelinePage,
  timelineEntrySelect,
  toTimelineEntryResponse,
} from "@/lib/timeline"
import type { NoteStageChange } from "@/lib/timeline-actions"
import { readTicketActionRequest } from "@/lib/action-buttons"
import { moveTicketStatus } from "@/lib/ticket-update"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { ticketNoteAudit, ticketStatusAudit } from "@/lib/ticket-audit"
import type { Prisma } from "@/generated/prisma"

// The ticket's timeline, newest first, TIMELINE_PAGE_SIZE at a time, the
// same as an opportunity's. ?cursor= must be an entry of this ticket.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.tickets",
    message: "You do not have permission to view tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const ticket = await loadViewableTicket(ctx, id)
  if (!ticket) return notFound()

  const cursor = req.nextUrl.searchParams.get("cursor") || null
  if (cursor && !(await loadTicketTimelineEntry(ctx, ticket.id, cursor))) return apiError(400, INVALID_CURSOR_MESSAGE)

  return NextResponse.json(await readTimelinePage(prisma, ticketTimelineWhere(ctx, ticket.id), cursor))
}

// Adds a note by the signed in user, like the opportunity note route, with
// the ticket's status in place of a stage: an optional statusId moves the
// ticket in the same transaction (resolvedAt and closedAt follow its
// category), recorded on the note itself (data.statusChange), never as a
// separate status_changed entry. An optional actionButtonId names the NOTE
// button it was posted with (readTicketActionRequest): its status rule and
// note rule apply and its label is stored (data.actionButton). The audit
// log gets the status change (field_changed statusId) and the note.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.edit",
    message: "You do not have permission to edit tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const ticket = await loadViewableTicket(ctx, id)
  if (!ticket) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const action = await readTicketActionRequest(ctx, body, "NOTE")
  if (action.response) return action.response
  const { button, status } = action
  const note = action.noteRequired ? readNoteBody(body.body) : readOptionalNoteBody(body.body)
  if (note.error !== undefined) return apiError(400, note.error)

  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    const statusChange: NoteStageChange | null = status ? await moveTicketStatus(tx, ctx, ticket.id, status, now) : null
    // An empty optional note that moves nothing has nothing to say
    if (note.value === null && !statusChange) return null
    const data = {
      ...(statusChange ? { statusChange } : {}),
      ...(button ? { actionButton: { id: button.id, label: button.label } } : {}),
    }
    const created = await tx.timelineEntry.create({
      data: {
        companyId: ctx.companyId,
        ticketId: ticket.id,
        kind: "NOTE",
        authorId: ctx.userId,
        body: note.value,
        ...(Object.keys(data).length > 0 ? { data: data as unknown as Prisma.InputJsonObject } : {}),
        createdAt: now,
      },
      select: timelineEntrySelect,
    })
    const audits: AuditEntryInput[] = []
    if (statusChange) audits.push(ticketStatusAudit(ticket, statusChange.from, statusChange.to))
    if (note.value !== null) audits.push(ticketNoteAudit(ticket, "added", { entryId: created.id, after: note.value }))
    await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: audits, at: now })
    return created
  })
  if (!result) return apiError(400, NOTE_EMPTY_MESSAGE)
  return NextResponse.json(toTimelineEntryResponse(result))
}
