import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse } from "@/lib/refusal"
import { ticketStatusSelect, TICKET_STATUS_ORDER } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, readJsonObject, readText } from "@/lib/opportunity-rules"
import { isTicketStatusCategory, TICKET_NAME_MAX } from "@/lib/ticket-rules"

// The ticket statuses in the company's order, for ticket forms, Ticket
// Settings, and Action Buttons (a button's fixed ticket status)
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.tickets", "settingsSections.tickets", "settingsSections.actionButtons"],
    message: "You do not have permission to view ticket statuses",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const statuses = await prisma.ticketStatus.findMany({ where: { companyId: ctx.companyId }, select: ticketStatusSelect, orderBy: TICKET_STATUS_ORDER })
  return NextResponse.json(statuses)
}

// A new status, with its category (OPEN, WAITING, RESOLVED, or CLOSED, set
// once and never changed), goes at the end of the order. Names are unique,
// ignoring case.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)
  const name = readText(body.name, { label: "Status name", max: TICKET_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)
  if (!isTicketStatusCategory(body.category)) return apiError(400, "Invalid status category")
  const category = body.category

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx) => {
    const duplicate = await tx.ticketStatus.findFirst({ where: { companyId, name: { equals: name.value as string, mode: "insensitive" } }, select: { id: true } })
    if (duplicate) return refuse(400, "A status with this name already exists")
    const last = await tx.ticketStatus.aggregate({ where: { companyId }, _max: { sortOrder: true } })
    return tx.ticketStatus.create({
      data: { companyId, name: name.value as string, category, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: ticketStatusSelect,
    })
  })
  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
