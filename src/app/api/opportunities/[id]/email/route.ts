import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { loadViewableOpportunity, opportunityAttachmentsWhere, opportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { readJsonObject, stageChangeData, INVALID_BODY_MESSAGE } from "@/lib/opportunity-rules"
import { readActionRequest } from "@/lib/action-buttons"
import { NOTE_EMPTY_MESSAGE, readNoteBody, readOptionalNoteBody, timelineEntrySelect, toTimelineEntryResponse } from "@/lib/timeline"
import type { NoteStageChange } from "@/lib/timeline-actions"
import { RECORD_EMAIL_MESSAGES } from "@/lib/record-email"
import { deliverRecordEmail, emailEntryData, readEmailRequest } from "@/lib/record-email-delivery"
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

  // Recipients, subject, and attachment ids (attachments of this opportunity)
  const request = await readEmailRequest(ctx, body, (ids) => ({ opportunityId: opportunity.id, opportunityAttachmentId: ids }))
  if (request.response) return request.response
  const { recipients, subject } = request

  const action = await readActionRequest(ctx, body, "EMAIL")
  if (action.response) return action.response
  const { button, stage } = action
  const message = action.noteRequired ? readNoteBody(body.body) : readOptionalNoteBody(body.body)
  if (message.error !== undefined) return apiError(400, message.error === NOTE_EMPTY_MESSAGE ? RECORD_EMAIL_MESSAGES.messageRequired : message.error)

  // From mailbox, attachment sizes, the per user limit, the files, the
  // signature, and the send itself (shared with tickets)
  const delivery = await deliverRecordEmail(ctx, {
    requestedMailbox: body.sendAsConnectionId,
    loadAttachments: () =>
      prisma.opportunityAttachment.findMany({
        where: { id: { in: request.attachmentIds }, ...opportunityAttachmentsWhere(ctx, opportunity.id) },
        select: { id: true, fileName: true, fileUrl: true, fileSize: true },
        orderBy: { createdAt: "asc" },
      }),
    prefix: `opportunities/${opportunity.id}/`,
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
        email: emailEntryData(sender, recipients, subject, attachments),
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
      audits.push(opportunityEmailAudit(opportunity, { entryId: created.id, to: recipients.to, subject }))
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
