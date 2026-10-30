import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { deletedOpportunityWhere, opportunityWhere, viewableOpportunityIncludingDeletedWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { isPrismaError } from "@/lib/opportunity-rules"
import { recordTimelineActions } from "@/lib/timeline"
import { recordAudit } from "@/lib/audit-log"
import { opportunityRestoredAudit } from "@/lib/opportunity-audit"
import { userFacingError } from "@/lib/user-error"

const NOT_DELETED_MESSAGE = "This opportunity isn't deleted"
const RESTORE_REFUSED_MESSAGE = "This opportunity can't be restored because a record it depends on no longer exists."

// Restores a deleted opportunity (auditLog.restore, plus the opportunity
// view check with deleted ones included): one transaction clears deletedAt
// and deletedById and writes a restored audit entry and a restored timeline
// action. Everything it pointed at is kept as it is: its client, contact,
// team, stage, and type can't be deleted while the row exists (their
// relations refuse the delete), a deleted location was already cleared by
// the database (SET NULL), and an owner who left the team or was
// deactivated stays the owner, like any older opportunity, until it is
// changed. A refusal from the database is a 409 with a plain reason.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "auditLog.restore",
    message: "You do not have permission to restore from the audit log",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const opportunity = await prisma.opportunity.findFirst({
    where: viewableOpportunityIncludingDeletedWhere(ctx, id),
    select: { id: true, number: true, title: true, deletedAt: true },
  })
  if (!opportunity) return notFound()
  if (!opportunity.deletedAt) return apiError(409, NOT_DELETED_MESSAGE, "NOT_DELETED")

  try {
    const restored = await prisma.$transaction(async (tx) => {
      // Only a still deleted row, so two restores never both record
      const { count } = await tx.opportunity.updateMany({
        where: deletedOpportunityWhere(ctx, opportunity.id),
        data: { deletedAt: null, deletedById: null },
      })
      if (count === 0) return null
      const at = new Date()
      await recordTimelineActions(tx, {
        companyId: ctx.companyId,
        authorId: ctx.userId,
        subject: { opportunityId: opportunity.id },
        actions: [{ action: "restored", data: { label: "Opportunity" } }],
        at,
      })
      await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [opportunityRestoredAudit(opportunity)], at })
      return tx.opportunity.findFirstOrThrow({ where: opportunityWhere(ctx, opportunity.id), select: opportunityDetailSelect })
    })
    if (!restored) return apiError(409, NOT_DELETED_MESSAGE, "NOT_DELETED")
    return NextResponse.json(restored)
  } catch (err) {
    if (isPrismaError(err, "P2003") || isPrismaError(err, "P2025")) return apiError(409, RESTORE_REFUSED_MESSAGE, "RESTORE_REFUSED")
    const { message, status } = userFacingError(err, "Restoring an opportunity")
    return apiError(status, message)
  }
}
