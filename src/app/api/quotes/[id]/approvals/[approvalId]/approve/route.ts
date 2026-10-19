import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withoutPortalTokensOrNull } from "@/lib/portal-token"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote } from "@/lib/scoped-loaders"
import { completeApprovedQuote, recordApproval } from "@/lib/quote-approval"

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

  // The decision is recorded first and only once: a repeat request finds it
  // already decided and stops here, so it can never send anything again
  if (!(await recordApproval(approvalId, id, ctx.userId))) {
    return NextResponse.json({ error: "This approval has already been decided" }, { status: 400 })
  }

  // If every requirement on this quote is now approved, complete the send.
  // A failed send leaves the approval standing and the quote in DRAFT with
  // the email still held for the owner to send, and comes back as a warning.
  const remaining = await prisma.quoteApproval.count({
    where: { quoteId: id, status: "PENDING" },
  })
  const completion = remaining === 0 ? await completeApprovedQuote(id, companyId) : null

  const updatedQuote = await prisma.quote.findUnique({ where: { id } })
  return NextResponse.json({
    quote: withoutPortalTokensOrNull(updatedQuote),
    allApproved: remaining === 0,
    emailSent: completion?.outcome === "sent",
    ...(completion?.outcome === "send_failed" ? { warning: completion.warning } : {}),
  })
}