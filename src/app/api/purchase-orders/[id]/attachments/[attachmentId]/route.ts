import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadPurchaseOrderAttachment, purchaseOrderAttachmentWhere } from "@/lib/scoped-loaders"
import { deleteStoredObject } from "@/lib/uploads"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "purchaseOrders.edit",
    message: "You do not have permission to edit purchase orders",
  })
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadPurchaseOrderAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  const deleted = await prisma.pOAttachment.delete({
    where: purchaseOrderAttachmentWhere(ctx, id, attachmentId),
    select: { fileUrl: true, purchaseOrderId: true },
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `purchase-orders/${deleted.purchaseOrderId}/`)

  return NextResponse.json({ deleted: true })
}
