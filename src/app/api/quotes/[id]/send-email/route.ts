import { NextRequest, NextResponse } from "next/server"
import { sendQuoteEmail } from "@/lib/send-quote-email"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { quoteWhere, viewableQuoteWhere } from "@/lib/scoped-loaders"
import { escapeHtmlWithBreaks } from "@/lib/html"
import {
  MAX_RECIPIENTS,
  actorName,
  parseRecipients,
  resolveQuoteSender,
  sendAsNote,
  withNote,
} from "@/lib/quote-sender"

export const runtime = "nodejs"
export const maxDuration = 30

const MAX_SUBJECT = 255
const MAX_MESSAGE = 20000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.sendEmail",
    message: "You do not have permission to send quotes",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId

  const quote = await prisma.quote.findFirst({
    where: viewableQuoteWhere(ctx, id),
    include: { lineItems: true },
  })
  if (!quote) return notFound()

  const body = await req.json().catch(() => ({}))

  // The rep's message arrives as plain text and the HTML is built here, so
  // nothing typed into the dialog can put markup into the email
  const subject = typeof body.subject === "string" ? body.subject.trim() : ""
  const message = typeof body.message === "string" ? body.message.trim() : ""
  const to = parseRecipients(body.to)
  const cc = parseRecipients(body.cc)
  if (to.error !== undefined) return apiError(400, to.error)
  if (cc.error !== undefined) return apiError(400, cc.error)
  if (to.list.length === 0 || !subject || !message) {
    return apiError(400, "To, subject, and message are required")
  }
  if (to.list.length + cc.list.length > MAX_RECIPIENTS) {
    return apiError(400, `A quote can be sent to at most ${MAX_RECIPIENTS} recipients`)
  }
  if (subject.length > MAX_SUBJECT) return apiError(400, `Subject must be ${MAX_SUBJECT} characters or fewer`)
  if (message.length > MAX_MESSAGE) return apiError(400, `Message must be ${MAX_MESSAGE} characters or fewer`)

  if (quote.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only draft quotes can be sent. A quote pending approval must be approved first." },
      { status: 400 }
    )
  }

  // Which mailbox it goes out from, settled before anything is held or sent
  const rawRequested = body.sendAsConnectionId
  if (rawRequested !== undefined && rawRequested !== null && typeof rawRequested !== "string") {
    return apiError(400, "Invalid mailbox", "INVALID_REFERENCE")
  }
  const sender = await resolveQuoteSender(ctx, quote, rawRequested || null)
  if (!sender.ok) return apiError(sender.status, sender.error, sender.code)

  const clickerName = await actorName(ctx)
  const emailPayload = {
    to: to.list.join(", "),
    cc: cc.list.length > 0 ? cc.list.join(", ") : null,
    subject,
    bodyHtml: escapeHtmlWithBreaks(message),
    includePdf: body.includePdf !== false,
    connectionId: sender.mailbox.id,
    // Who clicked Send, so the audit note names them even when an
    // approver's click is what finally sends a held email
    sentByUserId: ctx.userId,
    sentByName: clickerName,
  }

  // ─── Evaluate active approval workflows against this quote ──────────────
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { companyId, active: true },
  })

  const total = quote.lineItems.reduce(
    (sum, li) => sum + li.unitPrice * li.quantity * (1 - li.discount / 100),
    0
  )
  const maxDiscount = quote.lineItems.reduce((max, li) => Math.max(max, li.discount), 0)

  const matched = workflows.filter((w) => {
    if (w.triggerType === "TOTAL_THRESHOLD") return w.thresholdValue != null && total >= w.thresholdValue
    if (w.triggerType === "DISCOUNT_THRESHOLD") return w.thresholdValue != null && maxDiscount >= w.thresholdValue
    if (w.triggerType === "SPECIFIC_USER") return w.triggerUserId === quote.userId
    return false
  })

  if (matched.length > 0) {
    // Needs sign-off: hold the composed email and its sender until approved
    await prisma.$transaction([
      ...matched.map((w) =>
        prisma.quoteApproval.upsert({
          where: { quoteId_workflowId: { quoteId: id, workflowId: w.id } },
          update: { status: "PENDING", approvedByUserId: null, decidedAt: null, reason: null },
          create: { quoteId: id, workflowId: w.id, status: "PENDING" },
        })
      ),
      prisma.quote.update({
        where: quoteWhere(ctx, id),
        data: { status: "PENDING_APPROVAL", pendingEmailPayload: emailPayload },
      }),
    ])

    const updated = await prisma.quote.findUnique({ where: quoteWhere(ctx, id) })
    return NextResponse.json({ ...updated, pendingApproval: true })
  }

  // No approval needed, send the email right now
  const result = await sendQuoteEmail({ quoteId: id, ...emailPayload })
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const note = sendAsNote({ userId: ctx.userId, name: clickerName }, sender.mailbox)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.quote.updateMany({
      where: { companyId, quoteNumber: quote.quoteNumber, id: { not: id } },
      data: { isActive: false },
    })
    return tx.quote.update({
      where: quoteWhere(ctx, id),
      data: { status: "SENT", sentAt: new Date(), isActive: true, internalNotes: withNote(quote.internalNotes, note) },
    })
  })

  return NextResponse.json(updated)
}
