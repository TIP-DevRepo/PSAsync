import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { opportunityTypeSelect, TYPE_ORDER } from "@/lib/opportunity-selects"
import { INVALID_BODY_MESSAGE, OPPORTUNITY_NAME_MAX, readJsonObject, readText } from "@/lib/opportunity-rules"

// The Opportunities page and Opportunity Settings both list the types
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.opportunities", "settingsSections.opportunities"],
    message: "You do not have permission to view opportunity types",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const types = await prisma.opportunityType.findMany({
    where: { companyId: ctx.companyId },
    select: opportunityTypeSelect,
    orderBy: TYPE_ORDER,
  })

  return NextResponse.json(types)
}

// A new type goes at the end of the order
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const name = readText(body.name, { label: "Type name", max: OPPORTUNITY_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)

  const companyId = ctx.companyId
  const duplicate = await prisma.opportunityType.findFirst({
    where: { companyId, name: { equals: name.value as string, mode: "insensitive" } },
    select: { id: true },
  })
  if (duplicate) return apiError(400, "A type with this name already exists")

  const last = await prisma.opportunityType.aggregate({ where: { companyId }, _max: { sortOrder: true } })
  const type = await prisma.opportunityType.create({
    data: { companyId, name: name.value as string, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    select: opportunityTypeSelect,
  })

  return NextResponse.json(type)
}
