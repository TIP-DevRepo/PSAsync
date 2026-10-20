import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { sendQuoteEmail } from "@/lib/send-quote-email"
import { loadCompanyMailbox, sendAsNote, withNote } from "@/lib/quote-sender"
import { applyTermsFreeze, loadCompanyDefaultTerms, termsFreezeFor } from "@/lib/quote-terms"
import { approvalFingerprint, approvalsCoverQuote, heldEmailOf, type HeldEmail } from "@/lib/approval-workflows"

// The held email and the fingerprint live with the workflow evaluation in
// src/lib/approval-workflows.ts
export { approvalFingerprint, type HeldEmail }

// Records one approver's decision, only while it is still pending. False
// when it was already decided (a double click, or a second request), so
// nothing after it runs twice.
export async function recordApproval(approvalId: string, quoteId: string, userId: string): Promise<boolean> {
  const result = await prisma.quoteApproval.updateMany({
    where: { id: approvalId, quoteId, status: "PENDING" },
    data: { status: "APPROVED", approvedByUserId: userId, decidedAt: new Date() },
  })
  return result.count === 1
}

export type CompletionResult =
  // The held email went out and the quote is SENT
  | { outcome: "sent" }
  // No email was held (marked sent without one), the quote is SENT
  | { outcome: "marked_sent" }
  // Approved, but the email couldn't be sent: the quote is back in DRAFT
  // with the email still held, so the owner can send it
  | { outcome: "send_failed"; warning: string }
  // The quote changed after approval was requested: not sent, back in
  // DRAFT with the email kept, and the owner must request approval again
  | { outcome: "stale"; warning: string }
  // Someone else's request is already completing this quote
  | { outcome: "skipped" }

export const STALE_APPROVAL_WARNING =
  "This quote changed after approval was requested, so it was not sent. The owner must request approval again."

// The quote changed after approval was requested (or now matches a
// workflow nobody approved), so nothing is sent. The completion already
// moved it back to DRAFT. The held email is kept for the Send dialog, with
// the reason shown on the quote and the approvals no longer counting (no
// approvedFingerprint), so sending again requests approval again, which
// resets the existing approvals to PENDING. The owner is notified.
async function markStale(quote: {
  id: string
  companyId: string
  userId: string
  quoteNumber: string
  version: number
  pendingEmailPayload: unknown
}) {
  const held = heldEmailOf(quote.pendingEmailPayload)
  const kept: HeldEmail | null = held
    ? { ...held, lastSendError: "it changed after approval was requested", approvalStale: true }
    : null
  if (kept) {
    delete kept.approvedFingerprint
    delete kept.requestedFingerprint
  }
  await prisma.quote.update({
    where: { id: quote.id, companyId: quote.companyId },
    data: { pendingEmailPayload: kept ? (kept as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
  })

  const displayNumber = quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber
  await prisma.notification.create({
    data: {
      companyId: quote.companyId,
      userId: quote.userId,
      // There is no notification type for approvals; this one shows the
      // message as written
      type: "QUOTE_COMMENT",
      message: `Quote ${displayNumber} changed after approval was requested, so it was not sent. Request approval again.`,
      link: `/dashboard/quotes/${quote.id}`,
    },
  })
}

type Sender = typeof sendQuoteEmail

// Finishes a quote once its last approval is granted. The quote is first
// claimed by moving it from PENDING_APPROVAL to DRAFT in one conditional
// write, so only one request ever sends the held email. If the send fails
// for any reason the quote simply stays in DRAFT with the email kept, never
// sent from another mailbox and never stranded. Before anything is sent the
// quote is checked again as it is now (approvalsCoverQuote): if it changed
// after approval was requested, or a workflow that matches now isn't
// approved, it is not sent either (markStale).
export async function completeApprovedQuote(
  quoteId: string,
  companyId: string,
  send: Sender = sendQuoteEmail
): Promise<CompletionResult> {
  const claimed = await prisma.quote.updateMany({
    where: { id: quoteId, companyId, status: "PENDING_APPROVAL" },
    data: { status: "DRAFT" },
  })
  if (claimed.count !== 1) return { outcome: "skipped" }

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, companyId },
    include: { lineItems: { select: { id: true, quantity: true, unitPrice: true, discount: true } } },
  })
  if (!quote) return { outcome: "skipped" }

  if (!(await approvalsCoverQuote(companyId, quote))) {
    await markStale(quote)
    return { outcome: "stale", warning: STALE_APPROVAL_WARNING }
  }

  // The quote only becomes sent here, so a quote using the company default
  // terms freezes the default as it is now: worked out once, used for the
  // held email's PDF, and stored in the write that marks it sent
  const freeze = termsFreezeFor(quote, await loadCompanyDefaultTerms(companyId))

  async function markSent(internalNotes: string | null | undefined) {
    await prisma.$transaction(async (tx) => {
      await applyTermsFreeze(tx, quoteId, freeze)
      await tx.quote.updateMany({
        where: { companyId, quoteNumber: quote!.quoteNumber, id: { not: quoteId } },
        data: { isActive: false },
      })
      await tx.quote.update({
        where: { id: quoteId, companyId },
        data: { status: "SENT", sentAt: new Date(), isActive: true, pendingEmailPayload: Prisma.JsonNull, internalNotes },
      })
    })
  }

  // A payload with only the recorded fingerprint means no email was held
  const held = heldEmailOf(quote.pendingEmailPayload)
  if (!held) {
    await markSent(undefined)
    return { outcome: "marked_sent" }
  }

  // From the mailbox chosen when Send was clicked, never the approver's
  let error: string | null = null
  try {
    const result = await send({
      quoteId,
      to: held.to,
      cc: held.cc,
      subject: held.subject,
      bodyHtml: held.bodyHtml,
      includePdf: held.includePdf,
      connectionId: held.connectionId ?? null,
      termsFreeze: freeze,
    })
    if (!result.success) error = result.error || "the email service refused it"
  } catch (err) {
    console.error("Sending an approved quote's email failed:", err)
    error = "the email service failed"
  }

  if (error) {
    const kept: HeldEmail = {
      ...held,
      lastSendError: error,
      approvedFingerprint: approvalFingerprint(quote.userId, quote.lineItems),
    }
    await prisma.quote.update({
      where: { id: quoteId, companyId },
      data: { pendingEmailPayload: kept as unknown as Prisma.InputJsonValue },
    })
    return { outcome: "send_failed", warning: error }
  }

  let note: string | null = null
  if (held.connectionId && held.sentByUserId) {
    const mailbox = await loadCompanyMailbox(companyId, held.connectionId)
    if (mailbox) note = sendAsNote({ userId: held.sentByUserId, name: held.sentByName ?? "a team member" }, mailbox)
  }
  await markSent(withNote(quote.internalNotes, note))
  return { outcome: "sent" }
}
