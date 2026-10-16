import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { notFound, requireAccess } from "@/lib/api-access"
import { loadViewableQuote } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const quote = await loadViewableQuote(ctx, id)
  if (!quote) return notFound()

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
