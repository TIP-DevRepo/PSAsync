import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadTicketAttachment, ticketAttachmentWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { deleteStoredObject } from "@/lib/uploads"
import { recordTimelineActions } from "@/lib/timeline"
import { attachmentAction } from "@/lib/opportunity-timeline"
import { recordAudit } from "@/lib/audit-log"
import { ticketAttachmentAudit } from "@/lib/ticket-audit"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "tickets.edit",
    message: "You do not have permission to edit tickets",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const { id, attachmentId } = await params
  const existing = await loadTicketAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  // The row and its timeline and audit entries go together. The audit
  // entry keeps the file's name and size; the file itself is not restorable.
  const deleted = await prisma.$transaction(async (tx) => {
    const removed = await tx.ticketAttachment.delete({
      where: ticketAttachmentWhere(ctx, id, attachmentId),
      select: { id: true, fileName: true, fileUrl: true, fileSize: true, ticketId: true, ticket: { select: { id: true, number: true, title: true } } },
    })
    await recordTimelineActions(tx, { companyId: ctx.companyId, authorId: ctx.userId, subject: { ticketId: removed.ticketId }, actions: [attachmentAction("removed", removed)] })
    await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [ticketAttachmentAudit(removed.ticket, "removed", removed)] })
    return removed
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `tickets/${deleted.ticketId}/`)

  return NextResponse.json({ deleted: true })
}
