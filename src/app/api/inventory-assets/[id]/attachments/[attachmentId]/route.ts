import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { inventoryAssetAttachmentWhere, loadInventoryAssetAttachment } from "@/lib/scoped-loaders"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadInventoryAssetAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  await prisma.inventoryAssetAttachment.delete({ where: inventoryAssetAttachmentWhere(ctx, id, attachmentId) })

  return NextResponse.json({ deleted: true })
}
