import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import {
  assertRefs,
  mayAssignOpportunityTo,
  opportunityStageWhere,
  opportunityWhere,
  OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE,
  viewableOpportunityWhere,
  type BodyRefs,
} from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { opportunityDetailSelect } from "@/lib/opportunity-selects"
import {
  INVALID_BODY_MESSAGE,
  isPrismaError,
  linkedRecordsMessage,
  OPPORTUNITY_NOTES_MAX,
  OPPORTUNITY_TITLE_MAX,
  readDate,
  readExpectedValue,
  readJsonObject,
  readOptionalId,
  readText,
  stageChangeData,
} from "@/lib/opportunity-rules"
import { deleteStoredObjects } from "@/lib/uploads"
import { userFacingError } from "@/lib/user-error"
import type { Prisma } from "@/generated/prisma"

const isBlank = (value: unknown) => value === undefined || value === null || value === ""

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

  const { id } = await params
  const opportunity = await prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, id),
    select: opportunityDetailSelect,
  })
  if (!opportunity) return notFound()

  return NextResponse.json(opportunity)
}

// Changes only the fields the body includes
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

  const { id } = await params
  const existing = await prisma.opportunity.findFirst({
    where: viewableOpportunityWhere(ctx, id),
    select: { id: true, clientId: true, contactId: true, stageId: true },
  })
  if (!existing) return notFound()

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const data: Prisma.OpportunityUncheckedUpdateInput = {}
  const refs: BodyRefs = {}

  if ("title" in body) {
    const title = readText(body.title, { label: "Title", max: OPPORTUNITY_TITLE_MAX, required: true })
    if (title.error !== undefined) return apiError(400, title.error)
    data.title = title.value as string
  }
  if ("notes" in body) {
    const notes = readText(body.notes, { label: "Notes", max: OPPORTUNITY_NOTES_MAX })
    if (notes.error !== undefined) return apiError(400, notes.error)
    data.notes = notes.value
  }
  if ("expectedValue" in body) {
    const expectedValue = readExpectedValue(body.expectedValue)
    if (expectedValue.error !== undefined) return apiError(400, expectedValue.error)
    data.expectedValue = expectedValue.value
  }
  if ("expectedCloseDate" in body) {
    const expectedCloseDate = readDate(body.expectedCloseDate)
    if (expectedCloseDate.error !== undefined) return apiError(400, expectedCloseDate.error)
    data.expectedCloseDate = expectedCloseDate.value
  }

  // Null or blank unassigns. Without opportunities.viewAll only the caller
  // or unassigned.
  if ("ownerId" in body) {
    const owner = readOptionalId(body.ownerId)
    if (owner.error !== undefined) return apiError(400, "Invalid user", "INVALID_REFERENCE")
    if (!mayAssignOpportunityTo(ctx, owner.value)) {
      return apiError(403, OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE, "FORBIDDEN")
    }
    data.ownerId = owner.value
    refs.userId = owner.value
  }

  // A new client or contact is checked as a pair, so the contact (new or
  // kept) always belongs to the client (new or kept)
  if ("clientId" in body || "contactId" in body) {
    if ("clientId" in body && isBlank(body.clientId)) return apiError(400, "A client is required")
    if ("contactId" in body && isBlank(body.contactId)) return apiError(400, "A contact is required")
    refs.clientId = "clientId" in body ? body.clientId : existing.clientId
    refs.contactId = "contactId" in body ? body.contactId : existing.contactId
    if ("clientId" in body) data.clientId = body.clientId as string
    if ("contactId" in body) data.contactId = body.contactId as string
  }

  if ("stageId" in body) {
    if (isBlank(body.stageId)) return apiError(400, "A stage is required")
    refs.opportunityStageId = body.stageId
  }
  if ("typeId" in body) {
    const type = readOptionalId(body.typeId)
    if (type.error !== undefined) return apiError(400, "Invalid opportunity type", "INVALID_REFERENCE")
    data.typeId = type.value
    refs.opportunityTypeId = type.value
  }

  const invalid = await assertRefs(ctx, refs)
  if (invalid) return invalid

  // Moving to another stage stamps stageChangedAt and sets or clears closedAt
  if ("stageId" in body) {
    const stage = await prisma.opportunityStage.findFirst({
      where: opportunityStageWhere(ctx, body.stageId as string),
      select: { id: true, category: true },
    })
    if (!stage) return apiError(400, "Invalid stage", "INVALID_REFERENCE")
    Object.assign(data, stageChangeData({ id: existing.stageId }, stage, new Date()))
  }

  try {
    const opportunity = await prisma.opportunity.update({
      where: opportunityWhere(ctx, existing.id),
      data,
      select: opportunityDetailSelect,
    })
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
