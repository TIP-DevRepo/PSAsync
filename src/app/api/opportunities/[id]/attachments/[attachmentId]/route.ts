import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadOpportunityAttachment, opportunityAttachmentWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { deleteStoredObject } from "@/lib/uploads"
import { recordTimelineActions } from "@/lib/timeline"
import { attachmentAction } from "@/lib/opportunity-timeline"
import { recordAudit } from "@/lib/audit-log"
import { opportunityAttachmentAudit } from "@/lib/opportunity-audit"

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
  await ensureTeamDefaults(ctx.companyId)

  const { id, attachmentId } = await params
  const existing = await loadOpportunityAttachment(ctx, id, attachmentId)
  if (!existing) return notFound()

  // The row and its timeline and audit entries go together. The audit
  // entry keeps the file's name and size; the file itself is not restorable.
  const deleted = await prisma.$transaction(async (tx) => {
    const removed = await tx.opportunityAttachment.delete({
      where: opportunityAttachmentWhere(ctx, id, attachmentId),
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        fileSize: true,
        opportunityId: true,
        opportunity: { select: { id: true, number: true, title: true } },
      },
    })
    await recordTimelineActions(tx, {
      companyId: ctx.companyId,
      authorId: ctx.userId,
      subject: { opportunityId: removed.opportunityId },
      actions: [attachmentAction("removed", removed)],
    })
    await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [opportunityAttachmentAudit(removed.opportunity, "removed", removed)] })
    return removed
  })

  // Best effort once the row is gone: a failure is logged, never shown
  await deleteStoredObject(deleted.fileUrl, `opportunities/${deleted.opportunityId}/`)

  return NextResponse.json({ deleted: true })
}
