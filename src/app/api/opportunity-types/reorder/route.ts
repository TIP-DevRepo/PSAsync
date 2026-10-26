import { NextRequest, NextResponse } from "next/server"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureOpportunityDefaults, isRefusal, refuse, withOpportunitySettingsLock } from "@/lib/opportunity-defaults"
import { opportunityTypeSelect, TYPE_ORDER } from "@/lib/opportunity-selects"
import { readJsonObject, TYPE_ORDER_MESSAGE, TYPE_ORDER_STALE_MESSAGE } from "@/lib/opportunity-rules"

// Saves a new type order, the same way the stage reorder does: the body is
// every one of the company's type ids, first to last, renumbered 0 up in
// one transaction. A list that isn't exactly the company's types (one added
// or deleted since it was loaded, or another company's) is refused, so
// nothing is silently dropped or reshuffled.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.opportunities",
    message: "You do not have permission to manage opportunity settings",
  })
  if (response) return response

  await ensureOpportunityDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  const typeIds: unknown = body?.typeIds
  if (!Array.isArray(typeIds) || !typeIds.every((t) => typeof t === "string") || new Set(typeIds).size !== typeIds.length) {
    return apiError(400, TYPE_ORDER_MESSAGE)
  }
  const ids = typeIds as string[]

  const companyId = ctx.companyId
  const types = await withOpportunitySettingsLock(companyId, async (tx) => {
    const current = await tx.opportunityType.findMany({ where: { companyId }, select: { id: true } })
    const currentIds = new Set(current.map((t) => t.id))
    if (ids.length !== current.length || !ids.every((id) => currentIds.has(id))) {
      return refuse(409, TYPE_ORDER_STALE_MESSAGE, "TYPE_LIST_CHANGED")
    }
    for (const [index, id] of ids.entries()) {
      await tx.opportunityType.update({ where: { id, companyId }, data: { sortOrder: index } })
    }
    return tx.opportunityType.findMany({ where: { companyId }, select: opportunityTypeSelect, orderBy: TYPE_ORDER })
  })

  if (isRefusal(types)) return apiError(types.status, types.error, types.code)
  return NextResponse.json(types)
}
