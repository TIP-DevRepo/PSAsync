import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadViewableOpportunity, opportunityAttachmentsWhere, opportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { readJsonObject, stageChangeData, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import { readActionRequest } from "@/lib/action-buttons"
import { NOTE_EMPTY_MESSAGE, readNoteBody, readOptionalNoteBody, timelineEntrySelect, toTimelineEntryResponse } from "@/lib/timeline"
import type { NoteStageChange } from "@/lib/timeline-actions"
import { readAttachmentIds, readEmailRecipients, readEmailSubject, RECORD_EMAIL_MESSAGES } from "@/lib/record-email"
import { resolveOwnSender } from "@/lib/quote-sender"
import { EMAIL_ATTACHMENTS_MAX_BYTES, sendFromMailbox } from "@/lib/microsoft-mail"
import { readStoredObject } from "@/lib/uploads"
import { fileExtension, formatMegabytes, UPLOAD_TYPES } from "@/lib/upload-rules"
import { consumeSubject, emailLimitedResponse } from "@/lib/rate-limit"
import { escapeHtmlWithBreaks } from "@/lib/html"
import { recordAudit, type AuditEntryInput } from "@/lib/audit-log"
import { opportunityEmailAudit, opportunityStageAudit } from "@/lib/opportunity-audit"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

// Sends an email from the opportunity (the Email action) through the same
// Microsoft mailbox code and From rules as Send Quote, and records it on
// the timeline as an EMAIL_OUT entry. In order:
// - every address is checked (at least one To, at most 20 in all), the
//   subject loses its line breaks, the body is sanitized like a note, and
//   attachment ids must be attachments of this opportunity (assertRefs)
// - an actionButtonId applies that EMAIL button's stage and text rules
//   (readActionRequest), the same as a note
// - the From mailbox follows resolveOwnSender: the shared mailbox when
//   Quote Settings names one, otherwise the user's own, and another
//   mailbox only with quotes.sendAsOthers
// - each user may send 30 emails per 10 minutes (record-email)
// Only after Microsoft accepts the message does one transaction write the
// entry (author, from, to, cc, bcc, subject, body, attachment names, the
// button's label) and move the stage, recorded on the same entry like a
// note, with the audit entries (email_sent, and field_changed for a stage
// move). A failed send records nothing and answers a plain error.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const recipients = readEmailRecipients(body)
  if (recipients.error !== undefined) return apiError(400, recipients.error)
  const subject = readEmailSubject(body.subject)
  if (subject.error !== undefined) return apiError(400, subject.error)
  const attachmentIds = readAttachmentIds(body.attachmentIds)
  if (attachmentIds.error !== undefined) return apiError(400, attachmentIds.error)
  const invalidAttachment = await assertRefs(ctx, { opportunityId: opportunity.id, opportunityAttachmentId: attachmentIds.value })
  if (invalidAttachment) return invalidAttachment

  const action = await readActionRequest(ctx, body, "EMAIL")
  if (action.response) return action.response
  const { button, stage } = action
  const message = action.noteRequired ? readNoteBody(body.body) : readOptionalNoteBody(body.body)
  if (message.error !== undefined) return apiError(400, message.error === NOTE_EMPTY_MESSAGE ? RECORD_EMAIL_MESSAGES.messageRequired : message.error)

  const requested = body.sendAsConnectionId
  if (requested !== undefined && requested !== null && typeof requested !== "string") {
    return apiError(400, "Invalid mailbox", "INVALID_REFERENCE")
  }
  const sender = await resolveOwnSender(ctx, requested || null)
  if (!sender.ok) return apiError(sender.status, sender.error, sender.code)

  const attachments = await prisma.opportunityAttachment.findMany({
    where: { id: { in: attachmentIds.value }, ...opportunityAttachmentsWhere(ctx, opportunity.id) },
    select: { id: true, fileName: true, fileUrl: true, fileSize: true },
    orderBy: { createdAt: "asc" },
  })
  const tooLarge = RECORD_EMAIL_MESSAGES.attachmentsTooLarge(formatMegabytes(EMAIL_ATTACHMENTS_MAX_BYTES))
  if (attachments.reduce((sum, a) => sum + (a.fileSize ?? 0), 0) > EMAIL_ATTACHMENTS_MAX_BYTES) return apiError(400, tooLarge)

  // Counted once the request is valid, before anything is read or sent
  const limit = await consumeSubject("record-email", ctx.userId)
  if (limit.blocked) return emailLimitedResponse(limit.retryAfterSeconds)

  const files: { name: string; contentType: string; bytes: Uint8Array }[] = []
  for (const a of attachments) {
    const bytes = await readStoredObject(a.fileUrl, `opportunities/${opportunity.id}/`)
    if (!bytes) return apiError(400, `Couldn't read the attachment ${a.fileName}. Try again, or send without it.`)
    const type = UPLOAD_TYPES[fileExtension(a.fileName)]
    files.push({ name: a.fileName, contentType: type?.contentType ?? "application/octet-stream", bytes })
  }
  if (files.reduce((sum, f) => sum + f.bytes.byteLength, 0) > EMAIL_ATTACHMENTS_MAX_BYTES) return apiError(400, tooLarge)

  // The company signature (Settings > Notifications) goes under the
  // message, as plain text
  const settings = await prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { emailSignature: true } })
  const signature = settings?.emailSignature?.trim() ? `<p>${escapeHtmlWithBreaks(settings.emailSignature.trim())}</p>` : ""
  const bodyHtml = `${message.value ?? ""}${signature}`

  const sent = await sendFromMailbox(ctx.companyId, sender.mailbox.id, {
    subject: subject.value,
    bodyHtml,
    to: recipients.value.to,
    cc: recipients.value.cc,
    bcc: recipients.value.bcc,
    attachments: files,
  })
  if (!sent.success) return apiError(400, sent.error ?? "Couldn't send the email. Please try again.")

  const now = new Date()
  let entry
  try {
    entry = await prisma.$transaction(async (tx) => {
      let stageChange: NoteStageChange | null = null
      if (stage) {
        const before = await tx.opportunity.findFirstOrThrow({
          where: opportunityWhere(ctx, opportunity.id),
          select: { stage: { select: { id: true, name: true, category: true } } },
        })
        const change = stageChangeData(before.stage, stage, now)
        if ("stageId" in change) {
          await tx.opportunity.update({ where: opportunityWhere(ctx, opportunity.id), data: change })
          stageChange = { from: before.stage, to: stage }
        }
      }
      const data = {
        email: {
          from: { id: sender.mailbox.id, email: sender.mailbox.email, name: sender.mailbox.ownerName },
          to: recipients.value.to,
          cc: recipients.value.cc,
          bcc: recipients.value.bcc,
          subject: subject.value,
          attachments: attachments.map((a) => ({ id: a.id, fileName: a.fileName })),
        },
        ...(stageChange ? { stageChange } : {}),
        ...(button ? { actionButton: { id: button.id, label: button.label } } : {}),
      }
      const created = await tx.timelineEntry.create({
        data: {
          companyId: ctx.companyId,
          opportunityId: opportunity.id,
          kind: "EMAIL_OUT",
          authorId: ctx.userId,
          body: bodyHtml,
          data: data as unknown as Prisma.InputJsonObject,
          createdAt: now,
        },
        select: timelineEntrySelect,
      })
      const audits: AuditEntryInput[] = []
      if (stageChange) audits.push(opportunityStageAudit(opportunity, stageChange.from, stageChange.to))
      audits.push(opportunityEmailAudit(opportunity, { entryId: created.id, to: recipients.value.to, subject: subject.value }))
      await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: audits, at: now })
      return created
    })
  } catch (err) {
    // The email has gone; only recording it failed. One log line with the
    // error's kind, never its values.
    console.error(`Opportunity email sent but not recorded (${err instanceof Error ? err.name : typeof err})`)
    return apiError(500, "The email was sent, but it couldn't be added to the timeline.")
  }
  return NextResponse.json(toTimelineEntryResponse(entry))
}
