import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadOpportunityAttachment, opportunityAttachmentWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { deleteStoredObject } from "@/lib/uploads"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const { id, attachmentId } = await params
  const existing = await loadOpportunityAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  const deleted = await prisma.opportunityAttachment.delete({
    where: opportunityAttachmentWhere(ctx, id, attachmentId),
    select: { fileUrl: true, opportunityId: true },
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `opportunities/${deleted.opportunityId}/`)

  return NextResponse.json({ deleted: true })
}
