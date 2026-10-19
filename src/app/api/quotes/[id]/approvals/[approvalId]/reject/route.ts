import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; approvalId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "quotes.approve",
    message: "You do not have permission to reject quotes",
  })
  if (response) return response

  const { id, approvalId } = await params
  const companyId = ctx.companyId

  // The approver must be able to open the quote. A pending approval they
  // can decide counts, so this only refuses approvals for other companies,
  // missing quotes, or ones above their rank.
  const viewable = await loadViewableQuote(ctx, id)
  if (!viewable) return notFound()

  const body = await req.json().catch(() => ({}))

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
      { error: `Only users with ${approval.workflow.requiredRole?.name ?? "sufficient"} permission or higher can reject this.` },
      { status: 403 }
    )
  }

  const reason = body.reason || ""
  const rejecter = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } })
  const note = `[Approval rejected — ${approval.workflow.name} by ${rejecter?.name || rejecter?.email}]${
    reason ? `: ${reason}` : ""
  }`

  await prisma.$transaction([
    // Record the decision on this specific requirement
    prisma.quoteApproval.update({
      where: { id: approvalId },
      data: { status: "REJECTED", approvedByUserId: ctx.userId, decidedAt: new Date(), reason },
    }),
    // Any other still-pending requirements on this quote are moot now —
    // they'll be freshly re-evaluated the next time it's sent
    prisma.quoteApproval.deleteMany({
      where: { quoteId: id, status: "PENDING" },
    }),
    // Send the quote back to Draft with a note of what happened
    prisma.quote.update({
      where: { id },
      data: {
        status: "DRAFT",
        internalNotes: approval.quote.internalNotes
          ? `${note}\n\n${approval.quote.internalNotes}`
          : note,
      },
    }),
  ])

  const updatedQuote = await prisma.quote.findUnique({ where: { id } })
  return NextResponse.json({ quote: updatedQuote })
}