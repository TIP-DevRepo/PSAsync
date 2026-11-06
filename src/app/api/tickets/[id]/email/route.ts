import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadViewableTicket, ticketAttachmentsWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults } from "@/lib/ticket-defaults"
import { INVALID_BODY_MESSAGE, readJsonObject } from "@/lib/opportunity-rules"
import { readTicketActionRequest } from "@/lib/action-buttons"
import { NOTE_EMPTY_MESSAGE, readNoteBody, readOptionalNoteBody, timelineEntrySelect, toTimelineEntryResponse } from "@/lib/timeline"
import type { NoteStageChange } from "@/lib/timeline-actions"
import { RECORD_EMAIL_MESSAGES } from "@/lib/record-email"
import { deliverRecordEmail, emailEntryData, readEmailRequest } from "@/lib/record-email-delivery"
import { moveTicketStatus } from "@/lib/ticket-update"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { ticketEmailAudit, ticketStatusAudit } from "@/lib/ticket-audit"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

// Sends an email from the ticket (the Email action) through the shared
// delivery the opportunity Email action uses (readEmailRequest and
// deliverRecordEmail: the same address, subject, attachment, From mailbox,
// per user limit, and signature rules), and records it on the timeline as
// an EMAIL_OUT entry. Attachment ids must be attachments of this ticket.
// An actionButtonId applies that EMAIL button's status and text rules
// (readTicketActionRequest). Only after Microsoft accepts the message does
// one transaction write the entry and move the status, recorded on the
// same entry (data.statusChange), with the audit entries (email_sent, and
// field_changed statusId for a move). A failed send records nothing.
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

  const request = await readEmailRequest(ctx, body, (ids) => ({ ticketId: ticket.id, ticketAttachmentId: ids }))
  if (request.response) return request.response
  const { recipients, subject } = request

  const action = await readTicketActionRequest(ctx, body, "EMAIL")
  if (action.response) return action.response
  const { button, status } = action
  const message = action.noteRequired ? readNoteBody(body.body) : readOptionalNoteBody(body.body)
  if (message.error !== undefined) return apiError(400, message.error === NOTE_EMPTY_MESSAGE ? RECORD_EMAIL_MESSAGES.messageRequired : message.error)

  const delivery = await deliverRecordEmail(ctx, {
    requestedMailbox: body.sendAsConnectionId,
    loadAttachments: () =>
      prisma.ticketAttachment.findMany({
        where: { id: { in: request.attachmentIds }, ...ticketAttachmentsWhere(ctx, ticket.id) },
        select: { id: true, fileName: true, fileUrl: true, fileSize: true },
        orderBy: { createdAt: "asc" },
      }),
    prefix: `tickets/${ticket.id}/`,
    recipients,
    subject,
    message: message.value,
  })
  if (delivery.response) return delivery.response
  const { sender, bodyHtml, attachments } = delivery

  const now = new Date()
  let entry
  try {
    entry = await prisma.$transaction(async (tx) => {
      const statusChange: NoteStageChange | null = status ? await moveTicketStatus(tx, ctx, ticket.id, status, now) : null
      const data = {
        email: emailEntryData(sender, recipients, subject, attachments),
        ...(statusChange ? { statusChange } : {}),
        ...(button ? { actionButton: { id: button.id, label: button.label } } : {}),
      }
      const created = await tx.timelineEntry.create({
        data: {
          companyId: ctx.companyId,
          ticketId: ticket.id,
          kind: "EMAIL_OUT",
          authorId: ctx.userId,
          body: bodyHtml,
          data: data as unknown as Prisma.InputJsonObject,
          createdAt: now,
        },
        select: timelineEntrySelect,
      })
      const audits: AuditEntryInput[] = []
      if (statusChange) audits.push(ticketStatusAudit(ticket, statusChange.from, statusChange.to))
      audits.push(ticketEmailAudit(ticket, { entryId: created.id, to: recipients.to, subject }))
      await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: audits, at: now })
      return created
    })
  } catch (err) {
    // The email has gone; only recording it failed. One log line with the
    // error's kind, never its values.
    console.error(`Ticket email sent but not recorded (${err instanceof Error ? err.name : typeof err})`)
    return apiError(500, "The email was sent, but it couldn't be added to the timeline.")
  }
  return NextResponse.json(toTimelineEntryResponse(entry))
}
