import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadVendorAttachment, vendorAttachmentWhere } from "@/lib/scoped-loaders"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadVendorAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  await prisma.vendorAttachment.delete({ where: vendorAttachmentWhere(ctx, id, attachmentId) })

  return NextResponse.json({ deleted: true })
}
