import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs, teamWhere } from "@/lib/scoped-loaders"
import { ensureTicketDefaults, withTicketSettingsLock } from "@/lib/ticket-defaults"
import { isRefusal, refuse } from "@/lib/refusal"
import { numberPrefixProblem } from "@/lib/number-prefix"
import { ticketSettingsSelect } from "@/lib/ticket-selects"
import { INVALID_BODY_MESSAGE, readJsonObject } from "@/lib/opportunity-rules"
import { AUTO_CLOSE_DAYS_MESSAGE, isAutoCloseDays } from "@/lib/ticket-rules"
import type { Prisma } from "@/generated/prisma"

// Ticket forms and Ticket Settings both read these
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["pages.tickets", "settingsSections.tickets"],
    message: "You do not have permission to view ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const settings = await prisma.ticketSettings.findUnique({ where: { companyId: ctx.companyId }, select: ticketSettingsSelect })
  return NextResponse.json(settings)
}

// prefix follows the quote prefix rule, checked only when it changes.
// defaultTeamId is a team of the company (required: it can be changed, never
// cleared). autoCloseResolvedDays is a whole number from 0 (off) to 365.
export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.tickets",
    message: "You do not have permission to manage ticket settings",
  })
  if (response) return response

  await ensureTicketDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const data: Prisma.TicketSettingsUncheckedUpdateInput = {}
  if ("defaultTeamId" in body) {
    if (body.defaultTeamId === undefined || body.defaultTeamId === null || body.defaultTeamId === "") return apiError(400, "A default team is required")
    if (typeof body.defaultTeamId !== "string") return apiError(400, "Invalid team", "INVALID_REFERENCE")
    const invalid = await assertRefs(ctx, { teamId: body.defaultTeamId })
    if (invalid) return invalid
    data.defaultTeamId = body.defaultTeamId
  }
  if ("autoCloseResolvedDays" in body) {
    if (!isAutoCloseDays(body.autoCloseResolvedDays)) return apiError(400, AUTO_CLOSE_DAYS_MESSAGE)
    data.autoCloseResolvedDays = body.autoCloseResolvedDays
  }

  const companyId = ctx.companyId
  const result = await withTicketSettingsLock(companyId, async (tx, current) => {
    // The prefix becomes part of every new number. Checked only when it
    // changes, the same as the quote prefix.
    if ("prefix" in body && body.prefix !== current.prefix) {
      const problem = numberPrefixProblem(body.prefix, "Ticket number")
      if (problem) return refuse(400, problem)
      data.prefix = body.prefix as string
    }
    // Checked again inside the lock, so a team deleted meanwhile is refused
    if (typeof data.defaultTeamId === "string" && !(await tx.team.findFirst({ where: teamWhere(ctx, data.defaultTeamId), select: { id: true } }))) {
      return refuse(400, "Invalid team", "INVALID_REFERENCE")
    }
    return tx.ticketSettings.update({ where: { companyId }, data, select: ticketSettingsSelect })
  })
  if (isRefusal(result)) return apiError(result.status, result.error, result.code)
  return NextResponse.json(result)
}
