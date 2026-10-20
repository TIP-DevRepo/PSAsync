import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadVendorAttachment, vendorAttachmentWhere } from "@/lib/scoped-loaders"
import { deleteStoredObject } from "@/lib/uploads"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to edit vendors",
  })
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadVendorAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  const deleted = await prisma.vendorAttachment.delete({
    where: vendorAttachmentWhere(ctx, id, attachmentId),
    select: { fileUrl: true, vendorId: true },
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `vendors/${deleted.vendorId}/`)

  return NextResponse.json({ deleted: true })
}
