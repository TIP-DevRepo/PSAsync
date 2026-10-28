import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { TEAM_ORDER, teamSelect } from "@/lib/team-selects"
import { TEAM_ORDER_MESSAGE, TEAM_ORDER_STALE_MESSAGE } from "@/lib/team-rules"
import { toTeamResponse } from "@/lib/teams"
import { readJsonObject } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"

class StaleList extends Error {}

// Saves a new team order, the same way the stage and type reorders do: the
// body is every one of the company's team ids, first to last, renumbered 0
// up in one transaction. A list that isn't exactly the company's teams (one
// added or deleted since it was loaded, or another company's) is a 409, so
// nothing is silently dropped or reshuffled.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.teams",
    message: "You do not have permission to manage teams",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  const teamIds: unknown = body?.teamIds
  if (!Array.isArray(teamIds) || !teamIds.every((t) => typeof t === "string") || new Set(teamIds).size !== teamIds.length) {
    return apiError(400, TEAM_ORDER_MESSAGE)
  }
  const ids = teamIds as string[]

  const companyId = ctx.companyId
  try {
    const teams = await prisma.$transaction(async (tx) => {
      const current = await tx.team.findMany({ where: { companyId }, select: { id: true } })
      const currentIds = new Set(current.map((t) => t.id))
      if (ids.length !== current.length || !ids.every((id) => currentIds.has(id))) throw new StaleList()
      for (const [index, id] of ids.entries()) {
        await tx.team.update({ where: { id, companyId }, data: { sortOrder: index } })
      }
      return tx.team.findMany({ where: { companyId }, select: teamSelect, orderBy: TEAM_ORDER })
    })
    return NextResponse.json(teams.map((team) => toTeamResponse(team, ctx)))
  } catch (err) {
    if (err instanceof StaleList) return apiError(409, TEAM_ORDER_STALE_MESSAGE, "TEAM_LIST_CHANGED")
    const { message, status } = userFacingError(err, "Reordering teams")
    return apiError(status, message)
  }
}
