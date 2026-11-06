import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, type AccessContext } from "@/lib/api-access"
import { assertRefs, type BodyRefs } from "@/lib/scoped-loaders"
import { readAttachmentIds, readEmailRecipients, readEmailSubject, RECORD_EMAIL_MESSAGES, type EmailRecipients } from "@/lib/record-email"
import { resolveOwnSender, type SenderMailbox } from "@/lib/quote-sender"
import { EMAIL_ATTACHMENTS_MAX_BYTES, sendFromMailbox } from "@/lib/microsoft-mail"
import { readStoredObject } from "@/lib/uploads"
import { fileExtension, formatMegabytes, UPLOAD_TYPES } from "@/lib/upload-rules"
import { consumeSubject, emailLimitedResponse } from "@/lib/rate-limit"
import { escapeHtmlWithBreaks } from "@/lib/html"

// The Email action's server side, shared by every record that has one
// (opportunities and tickets). A route reads the request with
// readEmailRequest, applies its own action button and message rules, then
// sends with deliverRecordEmail, and only records the email (an EMAIL_OUT
// timeline entry and an email_sent audit entry) once Microsoft accepted it.

export interface StoredAttachment {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
}

export type EmailRequest =
  | { response: NextResponse; recipients?: undefined; subject?: undefined; attachmentIds?: undefined }
  | { response?: undefined; recipients: EmailRecipients; subject: string; attachmentIds: string[] }

// Every address is checked (at least one To, at most 20 in all), the
// subject loses its line breaks, and attachment ids must be attachments of
// the record (attachmentRefs, the record's assertRefs keys)
export async function readEmailRequest(
  ctx: AccessContext,
  body: Record<string, unknown>,
  attachmentRefs: (ids: string[]) => BodyRefs
): Promise<EmailRequest> {
  const recipients = readEmailRecipients(body)
  if (recipients.error !== undefined) return { response: apiError(400, recipients.error) }
  const subject = readEmailSubject(body.subject)
  if (subject.error !== undefined) return { response: apiError(400, subject.error) }
  const attachmentIds = readAttachmentIds(body.attachmentIds)
  if (attachmentIds.error !== undefined) return { response: apiError(400, attachmentIds.error) }
  const invalidAttachment = await assertRefs(ctx, attachmentRefs(attachmentIds.value))
  if (invalidAttachment) return { response: invalidAttachment }
  return { recipients: recipients.value, subject: subject.value, attachmentIds: attachmentIds.value }
}

export type Delivery =
  | { response: NextResponse; sender?: undefined; bodyHtml?: undefined; attachments?: undefined }
  | { response?: undefined; sender: SenderMailbox; bodyHtml: string; attachments: StoredAttachment[] }

// Sends the email, in order:
// - the From mailbox follows resolveOwnSender: the shared mailbox when
//   Quote Settings names one, otherwise the user's own, and another
//   mailbox only with quotes.sendAsOthers
// - the attachments' stored sizes must fit EMAIL_ATTACHMENTS_MAX_BYTES
// - each user may send 30 emails per 10 minutes (record-email), counted
//   once the request is valid, before anything is read or sent
// - the files are read from the uploads bucket (prefix, the record's
//   folder) and their real total checked again
// - the company signature (Settings > Notifications) goes under the
//   message, as plain text
// A failed send answers its plain error and nothing is recorded.
export async function deliverRecordEmail(
  ctx: AccessContext,
  opts: {
    requestedMailbox: unknown
    loadAttachments: () => Promise<StoredAttachment[]>
    prefix: string
    recipients: EmailRecipients
    subject: string
    message: string | null
  }
): Promise<Delivery> {
  const requested = opts.requestedMailbox
  if (requested !== undefined && requested !== null && typeof requested !== "string") {
    return { response: apiError(400, "Invalid mailbox", "INVALID_REFERENCE") }
  }
  const sender = await resolveOwnSender(ctx, requested || null)
  if (!sender.ok) return { response: apiError(sender.status, sender.error, sender.code) }

  const attachments = await opts.loadAttachments()
  const tooLarge = RECORD_EMAIL_MESSAGES.attachmentsTooLarge(formatMegabytes(EMAIL_ATTACHMENTS_MAX_BYTES))
  if (attachments.reduce((sum, a) => sum + (a.fileSize ?? 0), 0) > EMAIL_ATTACHMENTS_MAX_BYTES) return { response: apiError(400, tooLarge) }

  const limit = await consumeSubject("record-email", ctx.userId)
  if (limit.blocked) return { response: emailLimitedResponse(limit.retryAfterSeconds) }

  const files: { name: string; contentType: string; bytes: Uint8Array }[] = []
  for (const a of attachments) {
    const bytes = await readStoredObject(a.fileUrl, opts.prefix)
    if (!bytes) return { response: apiError(400, `Couldn't read the attachment ${a.fileName}. Try again, or send without it.`) }
    const type = UPLOAD_TYPES[fileExtension(a.fileName)]
    files.push({ name: a.fileName, contentType: type?.contentType ?? "application/octet-stream", bytes })
  }
  if (files.reduce((sum, f) => sum + f.bytes.byteLength, 0) > EMAIL_ATTACHMENTS_MAX_BYTES) return { response: apiError(400, tooLarge) }

  const settings = await prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { emailSignature: true } })
  const signature = settings?.emailSignature?.trim() ? `<p>${escapeHtmlWithBreaks(settings.emailSignature.trim())}</p>` : ""
  const bodyHtml = `${opts.message ?? ""}${signature}`

  const sent = await sendFromMailbox(ctx.companyId, sender.mailbox.id, {
    subject: opts.subject,
    bodyHtml,
    to: opts.recipients.to,
    cc: opts.recipients.cc,
    bcc: opts.recipients.bcc,
    attachments: files,
  })
  if (!sent.success) return { response: apiError(400, sent.error ?? "Couldn't send the email. Please try again.") }
  return { sender: sender.mailbox, bodyHtml, attachments }
}

// The email part of an EMAIL_OUT entry's data (emailOutDetails reads it)
export function emailEntryData(sender: SenderMailbox, recipients: EmailRecipients, subject: string, attachments: StoredAttachment[]) {
  return {
    from: { id: sender.id, email: sender.email, name: sender.ownerName },
    to: recipients.to,
    cc: recipients.cc,
    bcc: recipients.bcc,
    subject,
    attachments: attachments.map((a) => ({ id: a.id, fileName: a.fileName })),
  }
}
