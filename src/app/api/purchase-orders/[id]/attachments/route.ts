import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readUploadFromRequest, storeUpload } from "@/lib/uploads"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadViewablePurchaseOrder } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.purchaseOrders",
    message: "You do not have permission to view purchase orders",
  })
  if (response) return response

  const { id } = await params
  const order = await loadViewablePurchaseOrder(ctx, id)
  if (!order) return notFound()

  const attachments = await prisma.pOAttachment.findMany({
    where: { purchaseOrderId: order.id, purchaseOrder: { companyId: ctx.companyId } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(attachments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "purchaseOrders.edit",
    message: "You do not have permission to edit purchase orders",
  })
  if (response) return response

  const { id } = await params
  const order = await loadViewablePurchaseOrder(ctx, id)
  if (!order) return notFound()

  // Type, content, and size are checked here, and the stored key never
  // uses the file's own name
  const { file, response: rejected } = await readUploadFromRequest(req, "ATTACHMENT")
  if (rejected) return rejected

  const fileUrl = await storeUpload(file, { folder: `purchase-orders/${order.id}`, profile: "ATTACHMENT" })

  const attachment = await prisma.pOAttachment.create({
    data: {
      purchaseOrderId: order.id,
      fileName: file.displayName,
      fileUrl,
      fileSize: file.size,
      uploadedByUserId: ctx.userId,
    },
  })

  return NextResponse.json(attachment)
}
