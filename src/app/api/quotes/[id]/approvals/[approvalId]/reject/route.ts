import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; approvalId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id, approvalId } = await params
  const companyId = session.user.companyId
  const body = await req.json().catch(() => ({}))

  const approval = await prisma.quoteApproval.findUnique({
    where: { id: approvalId },
    include: { workflow: { include: { requiredRole: true } }, quote: true },
  })
  if (!approval || approval.quoteId !== id || approval.quote.companyId !== companyId) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 })
  }
  if (approval.status !== "PENDING") {
    return NextResponse.json({ error: "This approval has already been decided" }, { status: 400 })
  }

  // Role rank isn't reliable from the session token yet (JWT still reflects
  // whatever shape it had at login), so look up the current user's role
  // rank fresh from the database for this permission check
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  })

  const userRank = currentUser?.role?.isGlobalAdmin ? Number.MAX_SAFE_INTEGER : currentUser?.role?.rank ?? 0
  const requiredRank = approval.workflow.requiredRole?.rank ?? 999
  if (userRank < requiredRank) {
    return NextResponse.json(
      { error: `Only users with ${approval.workflow.requiredRole?.name ?? "sufficient"} permission or higher can reject this.` },
      { status: 403 }
    )
  }

  const reason = body.reason || ""
  const note = `[Approval rejected — ${approval.workflow.name} by ${session.user.name || session.user.email}]${
    reason ? `: ${reason}` : ""
  }`

  await prisma.$transaction([
    // Record the decision on this specific requirement
    prisma.quoteApproval.update({
      where: { id: approvalId },
      data: { status: "REJECTED", approvedByUserId: session.user.id, decidedAt: new Date(), reason },
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