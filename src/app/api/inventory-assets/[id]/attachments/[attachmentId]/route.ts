import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { inventoryAssetAttachmentWhere, loadInventoryAssetAttachment } from "@/lib/scoped-loaders"
import { deleteStoredObject } from "@/lib/uploads"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "inventory",
    message: "You do not have permission to edit inventory",
  })
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadInventoryAssetAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  const deleted = await prisma.inventoryAssetAttachment.delete({
    where: inventoryAssetAttachmentWhere(ctx, id, attachmentId),
    select: { fileUrl: true, assetId: true },
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `inventory-assets/${deleted.assetId}/`)

  return NextResponse.json({ deleted: true })
}
