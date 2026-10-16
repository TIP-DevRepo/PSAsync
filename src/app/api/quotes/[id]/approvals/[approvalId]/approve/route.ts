import { NextRequest, NextResponse } from "next/server"
import { sendQuoteEmail } from "@/lib/send-quote-email"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote } from "@/lib/scoped-loaders"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; approvalId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.approve",
    message: "You do not have permission to approve quotes",
  })
  if (response) return response

  const { id, approvalId } = await params
  const companyId = ctx.companyId

  // The approver must be able to open the quote. A pending approval they
  // can decide counts, so this only refuses approvals for other companies,
  // missing quotes, or ones above their rank.
  const viewable = await loadViewableQuote(ctx, id)
  if (!viewable) return notFound()


  const approval = await prisma.quoteApproval.findUnique({
    where: { id: approvalId },
    include: { workflow: { include: { requiredRole: true } }, quote: true },
  })
  if (!approval || approval.quoteId !== id || approval.quote.companyId !== companyId) {
    return notFound()
  }
  if (approval.status !== "PENDING") {
    return NextResponse.json({ error: "This approval has already been decided" }, { status: 400 })
  }

  // Highest rank across every role the user holds, resolved fresh from the
  // database (Global Admin always outranks any requirement)
  const userRank = ctx.access.rank
  const requiredRank = approval.workflow.requiredRole?.rank ?? 999
  if (userRank < requiredRank) {
    return NextResponse.json(
      { error: `Only users with ${approval.workflow.requiredRole?.name ?? "sufficient"} permission or higher can approve this.` },
      { status: 403 }
    )
  }

  await prisma.quoteApproval.update({
    where: { id: approvalId },
    data: { status: "APPROVED", approvedByUserId: ctx.userId, decidedAt: new Date() },
  })

  // If every requirement on this quote is now approved, complete the send
  const remaining = await prisma.quoteApproval.count({
    where: { quoteId: id, status: "PENDING" },
  })

  if (remaining === 0) {
    const quote = await prisma.quote.findUnique({ where: { id } })
    if (quote) {
      // If this quote was submitted through the Send Quote dialog, the
      // composed email was held until now — send it before going live
      if (quote.pendingEmailPayload) {
        const payload = quote.pendingEmailPayload as {
          to: string
          cc: string | null
          subject: string
          bodyHtml: string
          includePdf: boolean
        }
        const result = await sendQuoteEmail({ quoteId: id, ...payload })
        if (!result.success) {
          return NextResponse.json(
            { error: `Approved, but sending the email failed: ${result.error}` },
            { status: 500 }
          )
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.quote.updateMany({
          where: { companyId, quoteNumber: quote.quoteNumber, id: { not: id } },
          data: { isActive: false },
        })
        await tx.quote.update({
          where: { id },
          data: { status: "SENT", sentAt: new Date(), isActive: true, pendingEmailPayload: Prisma.JsonNull },
        })
      })
    }
  }

  const updatedQuote = await prisma.quote.findUnique({ where: { id } })
  return NextResponse.json({ quote: updatedQuote, allApproved: remaining === 0 })
}