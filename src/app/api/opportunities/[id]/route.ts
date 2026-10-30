import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { opportunityWhere, viewableOpportunityWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import { INVALID_BODY_MESSAGE, isPrismaError, linkedRecordsMessage, readJsonObject } from "@/lib/opportunity-rules"
import { deleteStoredObjects } from "@/lib/uploads"
import { applyOpportunityUpdate, opportunityUpdateExistingSelect, planOpportunityUpdate } from "@/lib/opportunity-update"
import { userFacingError } from "@/lib/user-error"

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
  if (!opportunity) return notFound()

  return NextResponse.json(opportunity)
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
// Otherwise its attachments go with it, rows and stored files.
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
  const opportunity = await prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, id),
    select: { id: true, _count: { select: { quotes: true, salesOrders: true, purchaseOrders: true } } },
  })
  if (!opportunity) return notFound()

  const blocked = linkedRecordsMessage(opportunity._count)
  if (blocked) return apiError(409, blocked, "OPPORTUNITY_LINKED")

  // The attachment rows cascade with the opportunity, so their files are
  // collected first and removed (best effort) once the delete succeeds
  const attachments = await prisma.opportunityAttachment.findMany({
    where: { opportunityId: opportunity.id, opportunity: { companyId: ctx.companyId } },
    select: { fileUrl: true },
  })

  try {
    await prisma.opportunity.delete({ where: opportunityWhere(ctx, opportunity.id) })
  } catch (err) {
    // A link added since the check above (the database refuses the delete)
    if (isPrismaError(err, "P2003")) {
      const counts = await prisma.opportunity.findFirst({
        where: opportunityWhere(ctx, opportunity.id),
        select: { _count: { select: { quotes: true, salesOrders: true, purchaseOrders: true } } },
      })
      const message = counts ? linkedRecordsMessage(counts._count) : null
      return apiError(409, message ?? "This opportunity is linked to other records, so it can't be deleted.", "OPPORTUNITY_LINKED")
    }
    const { message, status } = userFacingError(err, "Deleting an opportunity")
    return apiError(status, message)
  }

  await deleteStoredObjects(attachments.map((a) => a.fileUrl), `opportunities/${opportunity.id}/`)

  return NextResponse.json({ deleted: true })
}
