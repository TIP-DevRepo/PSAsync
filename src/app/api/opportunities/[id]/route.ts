import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { opportunityWhere, viewableOpportunityIncludingDeletedWhere, viewableOpportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { INVALID_BODY_MESSAGE, linkedRecordsMessage, readJsonObject } from "@/lib/opportunity-rules"
import { applyOpportunityUpdate, opportunityUpdateExistingSelect, planOpportunityUpdate } from "@/lib/opportunity-update"
import { userFacingError } from "@/lib/user-error"
import { recordAudit } from "@/lib/audit-log"
import { opportunityDeletedAudit } from "@/lib/opportunity-audit"

// Thrown inside the delete transaction when a link appeared since the check
class LinkedRefusal extends Error {
  constructor(readonly linkMessage: string) {
    super("Opportunity linked")
  }
}

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
  const opportunity = await prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, id),
    select: opportunityDetailSelect,
  })
  if (opportunity) return NextResponse.json(opportunity)

  // A deleted opportunity opens only for audit log viewers (from the audit
  // log), with deletedAt and deletedBy set; everyone else gets the 404
  if (!ctx.can("auditLog.view")) return notFound()
  const deleted = await prisma.opportunity.findFirst({
    where: viewableOpportunityIncludingDeletedWhere(ctx, id),
    select: opportunityDetailSelect,
  })
  return deleted ? NextResponse.json(deleted) : notFound()
}

// Changes only the fields the body includes, and records a timeline ACTION
// entry and an audit entry for each field that actually changed
export async function PATCH(
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
  const existing = await prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, id),
    select: opportunityUpdateExistingSelect,
  })
  if (!existing) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  // Every field rule lives in planOpportunityUpdate, shared with the audit
  // log undo
  const plan = await planOpportunityUpdate(ctx, existing, body)
  if (plan.response) return plan.response

  try {
    // The change, its timeline entries, and its audit entries are saved
    // together (nothing is recorded when the PATCH changed nothing)
    const opportunity = await prisma.$transaction(async (tx) => (await applyOpportunityUpdate(tx, ctx, existing.id, plan.data)).saved)
    return NextResponse.json(opportunity)
  } catch (err) {
    const { message, status } = userFacingError(err, "Editing an opportunity")
    return apiError(status, message)
  }
}

// Refused while any quote, sales order, or purchase order links to it.
// Otherwise the opportunity is hidden, not erased (deletedAt and
// deletedById, with a deleted audit entry, in one transaction): its
// attachments, their stored files, and its timeline are kept, and an admin
// with auditLog.restore can restore it from the audit log.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.delete",
    message: "You do not have permission to delete opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const linkCounts = { select: { quotes: true, salesOrders: true, purchaseOrders: true } } as const
  const opportunity = await prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, id),
    select: { id: true, number: true, title: true, _count: linkCounts },
  })
  if (!opportunity) return notFound()

  const blocked = linkedRecordsMessage(opportunity._count)
  if (blocked) return apiError(409, blocked, "OPPORTUNITY_LINKED")

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      // A link added since the check above still refuses the delete
      const counts = await tx.opportunity.findFirst({ where: opportunityWhere(ctx, opportunity.id), select: { _count: linkCounts } })
      if (!counts) return false
      const linked = linkedRecordsMessage(counts._count)
      if (linked) throw new LinkedRefusal(linked)
      const { count } = await tx.opportunity.updateMany({
        where: opportunityWhere(ctx, opportunity.id),
        data: { deletedAt: new Date(), deletedById: ctx.userId },
      })
      if (count === 0) return false
      await recordAudit(tx, { companyId: ctx.companyId, actorId: ctx.userId, entries: [opportunityDeletedAudit(opportunity)] })
      return true
    })
    // Deleted by someone else since the check
    if (!deleted) return notFound()
  } catch (err) {
    if (err instanceof LinkedRefusal) return apiError(409, err.linkMessage, "OPPORTUNITY_LINKED")
    const { message, status } = userFacingError(err, "Deleting an opportunity")
    return apiError(status, message)
  }

  return NextResponse.json({ deleted: true })
}
