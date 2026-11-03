import { NextRequest, NextResponse } from "next/server"
import { apiError, requireAccess } from "@/lib/api-access"
import { readJsonObject } from "@/lib/opportunity-rules"
import { isRefusal, refuse } from "@/lib/opportunity-defaults"
import {
  ACTION_BUTTON_ORDER,
  actionButtonSelect,
  BUTTON_ORDER_MESSAGE,
  BUTTON_ORDER_STALE_MESSAGE,
  ensureActionButtonDefaults,
  withActionButtonsLock,
} from "@/lib/action-buttons"
import { isAvailableActionKind } from "@/lib/timeline-buttons"

// Saves a new button order. The body is every one of the company's button
// ids, first to last, exactly as the list shows them; they're renumbered
// 0 up in one transaction. A list that isn't exactly the company's buttons
// (one added or deleted since it was loaded, or another company's) is
// refused with 409, so nothing is silently dropped or reshuffled.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.actionButtons",
    message: "You do not have permission to manage action buttons",
  })
  if (response) return response

  await ensureActionButtonDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  const buttonIds: unknown = body?.buttonIds
  if (!Array.isArray(buttonIds) || !buttonIds.every((s) => typeof s === "string") || new Set(buttonIds).size !== buttonIds.length) {
    return apiError(400, BUTTON_ORDER_MESSAGE)
  }
  const ids = buttonIds as string[]

  const companyId = ctx.companyId
  const buttons = await withActionButtonsLock(companyId, async (tx) => {
    const current = await tx.actionButton.findMany({ where: { companyId }, select: { id: true } })
    const currentIds = new Set(current.map((b) => b.id))
    if (ids.length !== current.length || !ids.every((id) => currentIds.has(id))) {
      return refuse(409, BUTTON_ORDER_STALE_MESSAGE, "BUTTON_LIST_CHANGED")
    }
    for (const [index, id] of ids.entries()) {
      await tx.actionButton.update({ where: { id, companyId }, data: { sortOrder: index } })
    }
    return tx.actionButton.findMany({ where: { companyId }, select: actionButtonSelect, orderBy: ACTION_BUTTON_ORDER })
  })

  if (isRefusal(buttons)) return apiError(buttons.status, buttons.error, buttons.code)
  return NextResponse.json(buttons.map((b) => ({ ...b, available: isAvailableActionKind(b.kind) })))
}
