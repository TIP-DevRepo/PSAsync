import { NextRequest, NextResponse } from "next/server"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse } from "@/lib/refusal"
import { ticketStatusSelect, TICKET_STATUS_ORDER } from "@/lib/ticket-selects"
import { readJsonObject } from "@/lib/opportunity-rules"
import { isSameIdList, orderMessages } from "@/lib/ticket-rules"

const MESSAGES = orderMessages("status")

// Saves a new status order: every one of the company's status ids, first to
// last; they're renumbered 0 up in one transaction. A list that isn't
// exactly the company's statuses (one added or deleted since it was loaded, or
// another company's) is refused with 409.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  const statusIds: unknown = body?.statusIds
  if (!Array.isArray(statusIds) || !statusIds.every((s) => typeof s === "string") || new Set(statusIds).size !== statusIds.length) {
    return apiError(400, MESSAGES.invalid)
  }
  const ids = statusIds as string[]

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const current = await tx.ticketStatus.findMany({ where: { companyId }, select: { id: true } })
    if (!isSameIdList(ids, current.map((s) => s.id))) return refuse(409, MESSAGES.stale, "STATUS_LIST_CHANGED")
    for (const [index, id] of ids.entries()) {
      await tx.ticketStatus.update({ where: { id, companyId }, data: { sortOrder: index } })
    }
    return tx.ticketStatus.findMany({ where: { companyId }, select: ticketStatusSelect, orderBy: TICKET_STATUS_ORDER })
  })
  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
