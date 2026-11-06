import { NextRequest, NextResponse } from "next/server"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse } from "@/lib/refusal"
import { ticketTypeSelect, TICKET_TYPE_ORDER } from "@/lib/ticket-selects"
import { readJsonObject } from "@/lib/opportunity-rules"
import { isSameIdList, orderMessages } from "@/lib/ticket-rules"

const MESSAGES = orderMessages("type")

// Saves a new type order: every one of the company's type ids, first to
// last; they're renumbered 0 up in one transaction. A list that isn't
// exactly the company's types (one added or deleted since it was loaded, or
// another company's) is refused with 409.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  const typeIds: unknown = body?.typeIds
  if (!Array.isArray(typeIds) || !typeIds.every((s) => typeof s === "string") || new Set(typeIds).size !== typeIds.length) {
    return apiError(400, MESSAGES.invalid)
  }
  const ids = typeIds as string[]

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const current = await tx.ticketType.findMany({ where: { companyId }, select: { id: true } })
    if (!isSameIdList(ids, current.map((t) => t.id))) return refuse(409, MESSAGES.stale, "TYPE_LIST_CHANGED")
    for (const [index, id] of ids.entries()) {
      await tx.ticketType.update({ where: { id, companyId }, data: { sortOrder: index } })
    }
    return tx.ticketType.findMany({ where: { companyId }, select: ticketTypeSelect, orderBy: TICKET_TYPE_ORDER })
  })
  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
