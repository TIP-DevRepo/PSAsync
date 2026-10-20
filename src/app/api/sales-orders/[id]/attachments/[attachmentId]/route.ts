import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadSalesOrderAttachment, salesOrderAttachmentWhere } from "@/lib/scoped-loaders"
import { deleteStoredObject } from "@/lib/uploads"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "salesOrders.edit",
    message: "You do not have permission to edit sales orders",
  })
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadSalesOrderAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  const deleted = await prisma.sOAttachment.delete({
    where: salesOrderAttachmentWhere(ctx, id, attachmentId),
    select: { fileUrl: true, salesOrderId: true },
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `sales-orders/${deleted.salesOrderId}/`)

  return NextResponse.json({ deleted: true })
}
