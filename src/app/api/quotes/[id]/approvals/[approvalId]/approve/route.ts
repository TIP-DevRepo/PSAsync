import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { sendQuoteEmail } from "@/lib/send-quote-email"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

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
      { error: `Only users with ${approval.workflow.requiredRole?.name ?? "sufficient"} permission or higher can approve this.` },
      { status: 403 }
    )
  }

  await prisma.quoteApproval.update({
    where: { id: approvalId },
    data: { status: "APPROVED", approvedByUserId: session.user.id, decidedAt: new Date() },
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