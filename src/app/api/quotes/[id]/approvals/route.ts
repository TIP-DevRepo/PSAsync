import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const quote = await prisma.quote.findUnique({
    where: { id, companyId: session.user.companyId },
  })
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  const approvals = await prisma.quoteApproval.findMany({
    where: { quoteId: id },
    include: {
      workflow: {
        select: {
          name: true,
          triggerType: true,
          requiredRole: { select: { id: true, name: true, rank: true, color: true, isGlobalAdmin: true } },
        },
      },
      approvedByUser: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(approvals)
}