import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse } from "@/lib/refusal"
import { ticketTypeSelect, TICKET_TYPE_ORDER } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, readJsonObject, readText } from "@/lib/opportunity-rules"
import { TICKET_NAME_MAX } from "@/lib/ticket-rules"

// The ticket types in the company's order, for ticket forms and Ticket Settings
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.tickets", "settingsSections.tickets"],
    message: "You do not have permission to view ticket types",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const types = await prisma.ticketType.findMany({ where: { companyId: ctx.companyId }, select: ticketTypeSelect, orderBy: TICKET_TYPE_ORDER })
  return NextResponse.json(types)
}

// A new type goes at the end of the order. Names are unique, ignoring case.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const name = readText(body.name, { label: "Type name", max: TICKET_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const duplicate = await tx.ticketType.findFirst({ where: { companyId, name: { equals: name.value as string, mode: "insensitive" } }, select: { id: true } })
    if (duplicate) return refuse(400, "A type with this name already exists")
    const last = await tx.ticketType.aggregate({ where: { companyId }, _max: { sortOrder: true } })
    return tx.ticketType.create({ data: { companyId, name: name.value as string, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: ticketTypeSelect })
  })
  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
