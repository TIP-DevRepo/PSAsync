import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadSalesOrderAttachment, salesOrderAttachmentWhere } from "@/lib/scoped-loaders"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, attachmentId } = await params
  const existing = await loadSalesOrderAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  await prisma.sOAttachment.delete({ where: salesOrderAttachmentWhere(ctx, id, attachmentId) })

  return NextResponse.json({ deleted: true })
}
