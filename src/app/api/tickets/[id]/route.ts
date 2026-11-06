import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { ticketWhere, viewableTicketWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { ticketDetailSelect } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, readJsonObject } from "@/lib/opportunity-rules"
import { applyTicketUpdate, planTicketUpdate, ticketUpdateExistingSelect } from "@/lib/ticket-update"
import { recordAudit } from "@/lib/audit-log"
import { ticketDeletedAudit } from "@/lib/ticket-audit"
import { userFacingError } from "@/lib/user-error"

// One ticket the user may open. A deleted ticket is never shown here, to
// anyone; it lives on only in the audit log, where it can be restored.
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
  const ticket = await prisma.ticket.findFirst({ where: viewableTicketWhere(ctx, id), select: ticketDetailSelect })
  return ticket ? NextResponse.json(ticket) : notFound()
}

// Changes only the fields the body includes (title, clientId, contactId,
// clientLocationId, teamId, assigneeId, typeId, priorityId, statusId; every
// rule in planTicketUpdate, shared with the audit log undo), and records a
// timeline ACTION entry and an audit entry for each field that changed
export async function PATCH(
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
  const existing = await prisma.ticket.findFirst({ where: viewableTicketWhere(ctx, id), select: ticketUpdateExistingSelect })
  if (!existing) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const plan = await planTicketUpdate(ctx, existing, body)
  if (plan.response) return plan.response

  try {
    const ticket = await prisma.$transaction(async (tx) => (await applyTicketUpdate(tx, ctx, existing.id, plan.data)).saved)
    return NextResponse.json(ticket)
  } catch (err) {
    const { message, status } = userFacingError(err, "Editing a ticket")
    return apiError(status, message)
  }
}

// Hides the ticket (deletedAt and deletedById, with a deleted audit entry,
// in one transaction). Its attachments, their stored files, and its
// timeline are kept, and an admin with auditLog.restore can restore it
// from the audit log.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.delete",
    message: "You do not have permission to delete tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const ticket = await prisma.ticket.findFirst({ where: viewableTicketWhere(ctx, id), select: { id: true, number: true, title: true } })
  if (!ticket) return notFound()

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({ where: ticketWhere(ctx, ticket.id), data: { deletedAt: new Date(), deletedById: ctx.userId } })
      if (count === 0) return false
      await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [ticketDeletedAudit(ticket)] })
      return true
    })
    // Deleted by someone else since the check
    if (!deleted) return notFound()
  } catch (err) {
    const { message, status } = userFacingError(err, "Deleting a ticket")
    return apiError(status, message)
  }

  return NextResponse.json({ deleted: true })
}
