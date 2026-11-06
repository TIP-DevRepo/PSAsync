import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readUploadFromRequest, storeUpload } from "@/lib/uploads"
import { notFound, requireAccess } from "@/lib/api-access"
import { withDownloadUrl } from "@/lib/attachment-paths"
import { loadViewableTicket, ticketAttachmentsWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { ticketAttachmentSelect } from "@/lib/ticket-selects"
import { recordTimelineActions } from "@/lib/timeline"
import { attachmentAction } from "@/lib/opportunity-timeline"
import { recordAudit } from "@/lib/audit-log"
import { ticketAttachmentAudit } from "@/lib/ticket-audit"

// The ticket's attachments, mirroring the opportunity attachment routes.
// Every one is returned with downloadUrl (the private download route),
// never its stored link.
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

  const attachments = await prisma.ticketAttachment.findMany({
    where: ticketAttachmentsWhere(ctx, ticket.id),
    select: ticketAttachmentSelect,
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(attachments.map((a) => withDownloadUrl("ticket", a)))
}

// Uploads one file (the ATTACHMENT profile) to tickets/<id>/<uuid>.<ext>
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

  // Type, content, and size are checked here, and the stored key never
  // uses the file's own name
  const { file, response: rejected } = await readUploadFromRequest(req, "ATTACHMENT")
  if (rejected) return rejected

  const fileUrl = await storeUpload(file, { folder: `tickets/${ticket.id}`, profile: "ATTACHMENT" })

  // The row and its timeline and audit entries are saved together
  const attachment = await prisma.$transaction(async (tx) => {
    const created = await tx.ticketAttachment.create({
      data: { ticketId: ticket.id, fileName: file.displayName, fileUrl, fileSize: file.size, uploadedByUserId: ctx.userId },
      select: ticketAttachmentSelect,
    })
    await recordTimelineActions(tx, { companyId: ctx.companyId, authorId: ctx.userId, subject: { ticketId: ticket.id }, actions: [attachmentAction("added", created)] })
    await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [ticketAttachmentAudit(ticket, "added", created)] })
    return created
  })

  return NextResponse.json(withDownloadUrl("ticket", attachment))
}
