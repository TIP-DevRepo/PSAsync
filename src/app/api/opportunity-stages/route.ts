import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { ensureOpportunityDefaults, isRefusal, refuse, withOpportunitySettingsLock } from "@/lib/opportunity-defaults"
import { opportunityStageSelect, STAGE_ORDER } from "@/lib/opportunity-selects"
import {
  INVALID_BODY_MESSAGE,
  isWinProbability,
  OPPORTUNITY_NAME_MAX,
  readJsonObject,
  readText,
  WIN_PROBABILITY_MESSAGE,
} from "@/lib/opportunity-rules"
import { OpportunityStageCategory } from "@/generated/prisma"

// The Opportunities page, Opportunity Settings, and Action Buttons (a
// button's fixed stage) all list the stages, in the company's order
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.opportunities", "settingsSections.opportunities", "settingsSections.actionButtons"],
    message: "You do not have permission to view opportunity stages",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const stages = await prisma.opportunityStage.findMany({
    where: { companyId: ctx.companyId },
    select: opportunityStageSelect,
    orderBy: STAGE_ORDER,
  })

  return NextResponse.json(stages)
}

// A new stage goes at the end of the order
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const name = readText(body.name, { label: "Stage name", max: OPPORTUNITY_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)
  if (!isEnumValue(OpportunityStageCategory, body.category)) return apiError(400, "Invalid stage category")
  const category = body.category
  // Left out: a Won stage is certain, every other stage starts at 0
  if (body.winProbability !== undefined && !isWinProbability(body.winProbability)) {
    return apiError(400, WIN_PROBABILITY_MESSAGE)
  }
  const winProbability = isWinProbability(body.winProbability) ? body.winProbability : category === "WON" ? 100 : 0

  const companyId = ctx.companyId
  const result = await withOpportunitySettingsLock(companyId, async (tx) => {
    const duplicate = await tx.opportunityStage.findFirst({
      where: { companyId, name: { equals: name.value as string, mode: "insensitive" } },
      select: { id: true },
    })
    if (duplicate) return refuse(400, "A stage with this name already exists")
    const last = await tx.opportunityStage.aggregate({ where: { companyId }, _max: { sortOrder: true } })
    return tx.opportunityStage.create({
      data: { companyId, name: name.value as string, category, winProbability, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: opportunityStageSelect,
    })
  })

  if (isRefusal(result)) return apiError(result.status, result.error)
  return NextResponse.json(result)
}
