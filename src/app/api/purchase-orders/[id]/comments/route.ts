import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadPurchaseOrder } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const order = await loadPurchaseOrder(ctx, id)
  if (!order) return notFound()

  const comments = await prisma.pOComment.findMany({
    where: { purchaseOrderId: order.id, purchaseOrder: { companyId: ctx.companyId } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(comments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const order = await loadPurchaseOrder(ctx, id)
  if (!order) return notFound()

  const body = await req.json()

  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: "A message is required" }, { status: 400 })
  }

  const comment = await prisma.pOComment.create({
    data: {
      purchaseOrderId: order.id,
      authorUserId: ctx.userId,
      authorName: ctx.userName ?? "Unknown",
      message: body.message.trim(),
    },
  })

  return NextResponse.json(comment)
}
