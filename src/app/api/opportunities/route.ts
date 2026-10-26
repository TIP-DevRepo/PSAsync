import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import {
  assertRefs,
  mayAssignOpportunityTo,
  opportunityListWhere,
  opportunityStageWhere,
  OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE,
} from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { takeOpportunityNumber } from "@/lib/opportunity-number"
import { opportunityDetailSelect, opportunityListSelect, STAGE_ORDER } from "@/lib/opportunity-selects"
import {
  closedAtFor,
  INVALID_BODY_MESSAGE,
  OPPORTUNITY_SEARCH_MAX,
  OPPORTUNITY_TITLE_MAX,
  readDate,
  readExpectedValue,
  readJsonObject,
  readOptionalId,
  readText,
} from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"
import type { Prisma } from "@/generated/prisma"

const DAY = 24 * 60 * 60 * 1000

// Every opportunity the user may open (their own and unassigned ones, or
// everyone's with opportunities.viewAll), newest first, the same as the
// quotes list. Filters: stageId, typeId, clientId, ownerId (a user id or
// "unassigned"), closeFrom and closeTo (YYYY-MM-DD, the expected close
// date, both days included), and q (title, number, or client name).
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "pages.opportunities",
    message: "You do not have permission to view opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const params = req.nextUrl.searchParams
  const stageId = params.get("stageId") || undefined
  const typeId = params.get("typeId") || undefined
  const clientId = params.get("clientId") || undefined
  const ownerParam = params.get("ownerId") || undefined
  const unassigned = ownerParam === "unassigned"
  const ownerId = unassigned ? undefined : ownerParam

  // Ids in the query are this company's (an owner may since be deactivated)
  const invalid = await assertRefs(ctx, {
    clientId,
    opportunityStageId: stageId,
    opportunityTypeId: typeId,
    companyUserId: ownerId,
  })
  if (invalid) return invalid

  const closeFrom = readDate(params.get("closeFrom"), "The close date range must use valid dates")
  if (closeFrom.error !== undefined) return apiError(400, closeFrom.error)
  const closeTo = readDate(params.get("closeTo"), "The close date range must use valid dates")
  if (closeTo.error !== undefined) return apiError(400, closeTo.error)

  const q = params.get("q")?.trim() ?? ""
  if (q.length > OPPORTUNITY_SEARCH_MAX) return apiError(400, `Search text must be ${OPPORTUNITY_SEARCH_MAX} characters or fewer`)

  const filters: Prisma.OpportunityWhereInput[] = []
  if (stageId) filters.push({ stageId })
  if (typeId) filters.push({ typeId })
  if (clientId) filters.push({ clientId })
  if (unassigned) filters.push({ ownerId: null })
  else if (ownerId) filters.push({ ownerId })
  if (closeFrom.value) filters.push({ expectedCloseDate: { gte: closeFrom.value } })
  // The whole closeTo day is included
  if (closeTo.value) filters.push({ expectedCloseDate: { lt: new Date(closeTo.value.getTime() + DAY) } })
  if (q) {
    filters.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { number: { contains: q, mode: "insensitive" } },
        { client: { name: { contains: q, mode: "insensitive" } } },
      ],
    })
  }

  const opportunities = await prisma.opportunity.findMany({
    where: { AND: [opportunityListWhere(ctx), ...filters] },
    select: opportunityListSelect,
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(opportunities)
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "opportunities.create",
    message: "You do not have permission to create opportunities",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const title = readText(body.title, { label: "Title", max: OPPORTUNITY_TITLE_MAX, required: true })
  if (title.error !== undefined) return apiError(400, title.error)
  const expectedValue = readExpectedValue(body.expectedValue)
  if (expectedValue.error !== undefined) return apiError(400, expectedValue.error)
  const expectedCloseDate = readDate(body.expectedCloseDate)
  if (expectedCloseDate.error !== undefined) return apiError(400, expectedCloseDate.error)

  if (body.clientId === undefined || body.clientId === null || body.clientId === "") {
    return apiError(400, "A client is required")
  }
  if (body.contactId === undefined || body.contactId === null || body.contactId === "") {
    return apiError(400, "A contact is required")
  }

  // The owner is the creator unless the body names someone, and null or
  // blank leaves it unassigned. Without opportunities.viewAll only the
  // creator or unassigned, the two owners they can still see.
  const owner = "ownerId" in body ? readOptionalId(body.ownerId) : { value: ctx.userId }
  if (owner.error !== undefined) return apiError(400, "Invalid user", "INVALID_REFERENCE")
  const ownerId = owner.value
  if (!mayAssignOpportunityTo(ctx, ownerId)) {
    return apiError(403, OPPORTUNITY_SELF_ASSIGN_ONLY_MESSAGE, "FORBIDDEN")
  }

  const stage = readOptionalId(body.stageId)
  if (stage.error !== undefined) return apiError(400, "Invalid stage", "INVALID_REFERENCE")
  const type = readOptionalId(body.typeId)
  if (type.error !== undefined) return apiError(400, "Invalid opportunity type", "INVALID_REFERENCE")

  // The contact must belong to the client, the owner must be an active user
  // here, and the stage and type this company's
  const invalid = await assertRefs(ctx, {
    clientId: body.clientId,
    contactId: body.contactId,
    userId: ownerId,
    opportunityStageId: stage.value,
    opportunityTypeId: type.value,
  })
  if (invalid) return invalid
  const clientId = body.clientId as string
  const contactId = body.contactId as string

  // The named stage, else the first OPEN stage in the company's order
  const chosenStage = await prisma.opportunityStage.findFirst({
    where: stage.value ? opportunityStageWhere(ctx, stage.value) : { companyId: ctx.companyId, category: "OPEN" },
    select: { id: true, category: true },
    orderBy: STAGE_ORDER,
  })
  if (!chosenStage) return apiError(400, "Add an open stage in Opportunity Settings first")

  const now = new Date()
  try {
    const opportunity = await prisma.$transaction(async (tx) => {
      const number = await takeOpportunityNumber(tx, ctx.companyId, now)
      return tx.opportunity.create({
        data: {
          companyId: ctx.companyId,
          number,
          title: title.value as string,
          clientId,
          contactId,
          ownerId,
          stageId: chosenStage.id,
          typeId: type.value,
          source: "MANUAL",
          expectedValue: expectedValue.value,
          expectedCloseDate: expectedCloseDate.value,
          stageChangedAt: now,
          closedAt: closedAtFor(chosenStage.category, now),
          createdById: ctx.userId,
        },
        select: opportunityDetailSelect,
      })
    })
    return NextResponse.json(opportunity)
  } catch (err) {
    const { message, status } = userFacingError(err, "Creating an opportunity")
    return apiError(status, message)
  }
}
