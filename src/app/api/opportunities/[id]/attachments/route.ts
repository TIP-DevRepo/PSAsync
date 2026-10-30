import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readUploadFromRequest, storeUpload } from "@/lib/uploads"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadViewableOpportunity } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { opportunityAttachmentSelect } from "@/lib/opportunity-selects"
import { recordTimelineActions } from "@/lib/timeline"
import { attachmentAction } from "@/lib/opportunity-timeline"
import { recordAudit } from "@/lib/audit-log"
import { opportunityAttachmentAudit } from "@/lib/opportunity-audit"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  const attachments = await prisma.opportunityAttachment.findMany({
    where: { opportunityId: opportunity.id, opportunity: { companyId: ctx.companyId } },
    select: opportunityAttachmentSelect,
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(attachments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.edit",
    message: "You do not have permission to edit opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await loadViewableOpportunity(ctx, id)
  if (!opportunity) return notFound()

  // Type, content, and size are checked here, and the stored key never
  // uses the file's own name
  const { file, response: rejected } = await readUploadFromRequest(req, "ATTACHMENT")
  if (rejected) return rejected

  const fileUrl = await storeUpload(file, { folder: `opportunities/${opportunity.id}`, profile: "ATTACHMENT" })

  // The row and its timeline and audit entries are saved together
  const attachment = await prisma.$transaction(async (tx) => {
    const created = await tx.opportunityAttachment.create({
      data: {
        opportunityId: opportunity.id,
        fileName: file.displayName,
        fileUrl,
        fileSize: file.size,
        uploadedByUserId: ctx.userId,
      },
      select: opportunityAttachmentSelect,
    })
    await recordTimelineActions(tx, {
      companyId: ctx.companyId,
      authorId: ctx.userId,
      subject: { opportunityId: opportunity.id },
      actions: [attachmentAction("added", created)],
    })
    await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [opportunityAttachmentAudit(opportunity, "added", created)] })
    return created
  })

  return NextResponse.json(attachment)
}
