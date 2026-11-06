import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse } from "@/lib/refusal"
import { ticketPrioritySelect, TICKET_PRIORITY_ORDER } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, readJsonObject, readText } from "@/lib/opportunity-rules"
import { TICKET_NAME_MAX } from "@/lib/ticket-rules"

// The ticket priorities in the company's order, for ticket forms and Ticket Settings
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.tickets", "settingsSections.tickets"],
    message: "You do not have permission to view ticket priorities",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const priorities = await prisma.ticketPriority.findMany({ where: { companyId: ctx.companyId }, select: ticketPrioritySelect, orderBy: TICKET_PRIORITY_ORDER })
  return NextResponse.json(priorities)
}

// A new priority goes at the end of the order. Names are unique, ignoring case.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const name = readText(body.name, { label: "Priority name", max: TICKET_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const duplicate = await tx.ticketPriority.findFirst({ where: { companyId, name: { equals: name.value as string, mode: "insensitive" } }, select: { id: true } })
    if (duplicate) return refuse(400, "A priority with this name already exists")
    const last = await tx.ticketPriority.aggregate({ where: { companyId }, _max: { sortOrder: true } })
    return tx.ticketPriority.create({ data: { companyId, name: name.value as string, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: ticketPrioritySelect })
  })
  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
