import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { deletedTicketWhere, ticketWhere, viewableTicketIncludingDeletedWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { ticketDetailSelect } from "@/lib/ticket-selects"
import { isPrismaError } from "@/lib/opportunity-rules"
import { NOT_DELETED_CODE, RESTORE_REFUSED_CODE, restoreDeletedRecord } from "@/lib/soft-delete"
import { ticketRestoredAudit } from "@/lib/ticket-audit"
import { userFacingError } from "@/lib/user-error"

const NOT_DELETED_MESSAGE = "This ticket isn't deleted"
const RESTORE_REFUSED_MESSAGE = "This ticket can't be restored because a record it depends on no longer exists."

// Restores a deleted ticket (auditLog.restore, plus the ticket view check
// with deleted ones included), the same way as an opportunity
// (restoreDeletedRecord): one transaction clears deletedAt and deletedById
// and writes a restored audit entry and a restored timeline action. Its
// client, contact, team, type, priority, and status can't be deleted while
// the row exists, a deleted location was already cleared (SET NULL), and an
// assignee who left the team stays the assignee until it is changed.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "auditLog.restore",
    message: "You do not have permission to restore from the audit log",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id } = await params
  const ticket = await prisma.ticket.findFirst({
    where: viewableTicketIncludingDeletedWhere(ctx, id),
    select: { id: true, number: true, title: true, deletedAt: true },
  })
  if (!ticket) return notFound()
  if (!ticket.deletedAt) return apiError(409, NOT_DELETED_MESSAGE, NOT_DELETED_CODE)

  try {
    const restored = await prisma.$transaction((tx) =>
      restoreDeletedRecord(tx, {
        companyId: ctx.companyId,
        actorId: ctx.userId,
        clear: () => tx.ticket.updateMany({ where: deletedTicketWhere(ctx, ticket.id), data: { deletedAt: null, deletedById: null } }),
        subject: { ticketId: ticket.id },
        label: "Ticket",
        audit: ticketRestoredAudit(ticket),
        read: () => tx.ticket.findFirstOrThrow({ where: ticketWhere(ctx, ticket.id), select: ticketDetailSelect }),
      })
    )
    if (!restored) return apiError(409, NOT_DELETED_MESSAGE, NOT_DELETED_CODE)
    return NextResponse.json(restored)
  } catch (err) {
    if (isPrismaError(err, "P2003") || isPrismaError(err, "P2025")) return apiError(409, RESTORE_REFUSED_MESSAGE, RESTORE_REFUSED_CODE)
    const { message, status } = userFacingError(err, "Restoring a ticket")
    return apiError(status, message)
  }
}
