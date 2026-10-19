import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { sendQuoteEmail } from "@/lib/send-quote-email"
import { loadCompanyMailbox, sendAsNote, withNote } from "@/lib/quote-sender"
import { applyTermsFreeze, loadCompanyDefaultTerms, termsFreezeFor } from "@/lib/quote-terms"

// The email composed in the Send Quote dialog, held on the quote
// (pendingEmailPayload) while it waits for approval
export interface HeldEmail {
  to: string
  cc: string | null
  subject: string
  bodyHtml: string
  includePdf: boolean
  // The rep's plain text message, so the dialog can show it again.
  // Missing on emails held before it was stored.
  message?: string
  // The mailbox chosen when Send was clicked. Missing on emails held
  // before the sender was stored.
  connectionId?: string
  sentByUserId?: string
  sentByName?: string
  // Set only when every approval was granted but the email couldn't be
  // sent: why, and what the approvals were granted for
  lastSendError?: string
  approvedFingerprint?: string
}

// What the approval workflows look at (the owner, and each line item's
// quantity, price, and discount), so approvals already granted can be
// honored only while none of it has changed
export function approvalFingerprint(
  userId: string,
  lineItems: { id: string; quantity: number; unitPrice: number; discount: number }[]
): string {
  const items = [...lineItems]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((li) => [li.id, li.quantity, li.unitPrice, li.discount])
  return JSON.stringify([userId, items])
}

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
  // Someone else's request is already completing this quote
  | { outcome: "skipped" }

type Sender = typeof sendQuoteEmail

// Finishes a quote once its last approval is granted. The quote is first
// claimed by moving it from PENDING_APPROVAL to DRAFT in one conditional
// write, so only one request ever sends the held email. If the send fails
// for any reason the quote simply stays in DRAFT with the email kept, never
// sent from another mailbox and never stranded.
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

  const held = quote.pendingEmailPayload as HeldEmail | null
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
