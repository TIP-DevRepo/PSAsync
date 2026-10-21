import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureOpportunityDefaults, lockOpportunitySettings } from "@/lib/opportunity-defaults"
import { opportunityStageSelect, STAGE_ORDER } from "@/lib/opportunity-selects"
import { readJsonObject, STAGE_ORDER_MESSAGE, STAGE_ORDER_STALE_MESSAGE } from "@/lib/opportunity-rules"

// Saves a new stage order. The body is every one of the company's stage
// ids, first to last, exactly as the list shows them; they're renumbered
// 0 up in one transaction. A list that isn't exactly the company's stages
// (one added or deleted since it was loaded, or another company's) is
// refused, so nothing is silently dropped or reshuffled.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  const stageIds: unknown = body?.stageIds
  if (!Array.isArray(stageIds) || !stageIds.every((s) => typeof s === "string") || new Set(stageIds).size !== stageIds.length) {
    return apiError(400, STAGE_ORDER_MESSAGE)
  }
  const ids = stageIds as string[]

  const companyId = ctx.companyId
  const stages = await prisma.$transaction(async (tx) => {
    await lockOpportunitySettings(tx, companyId)
    const current = await tx.opportunityStage.findMany({ where: { companyId }, select: { id: true } })
    const currentIds = new Set(current.map((s) => s.id))
    if (ids.length !== current.length || !ids.every((id) => currentIds.has(id))) return null
    for (const [index, id] of ids.entries()) {
      await tx.opportunityStage.update({ where: { id, companyId }, data: { sortOrder: index } })
    }
    return tx.opportunityStage.findMany({ where: { companyId }, select: opportunityStageSelect, orderBy: STAGE_ORDER })
  })

  if (!stages) return apiError(409, STAGE_ORDER_STALE_MESSAGE, "STAGE_LIST_CHANGED")
  return NextResponse.json(stages)
}
