import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadTeam } from "@/lib/scoped-loaders"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { teamSelect, type TeamRow } from "@/lib/team-selects"
import { membershipChangesRefusal, readIdList, setTeamMembers, teamsGrantRefusal, toTeamResponse, type TeamRefusal } from "@/lib/teams"
import { readJsonObject } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"

// Replaces the team's members with userIds. Every added user must be an
// active user of the company. Adding anyone to a team with default roles
// gives them those roles, so it follows the grant rule (teamsGrantRefusal:
// the caller ranks above each role and holds every permission it grants),
// and every user added or removed must rank below the caller (the Manage
// Users rule, membershipChangesRefusal), except that anyone may remove
// themselves. Either refusal is a 403. Members already in the team stay
// (even if deactivated since). Changes apply on each member's next request.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.teams",
    message: "You do not have permission to manage teams",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const { id } = await params
  const team = await loadTeam(ctx, id)
  if (!team) return notFound()

  const body = await readJsonObject(req)
  const userIds = readIdList(body?.userIds)
  if (userIds === null) return apiError(400, "Invalid user", "INVALID_REFERENCE")

  const current = await prisma.teamMember.findMany({ where: { teamId: team.id }, select: { userId: true } })
  const currentIds = new Set(current.map((m) => m.userId))
  const added = userIds.filter((userId) => !currentIds.has(userId))
  const removed = [...currentIds].filter((userId) => !userIds.includes(userId))

  // Every id a user of the company, and every added one active
  const invalid = await assertRefs(ctx, { companyUserId: userIds, userId: added })
  if (invalid) return invalid

  try {
    const saved = await prisma.$transaction(async (tx): Promise<{ refused: TeamRefusal } | { team: TeamRow }> => {
      // Read with the write, so a default role added in the meantime counts
      const grant = added.length > 0 ? await teamsGrantRefusal(tx, ctx, [team.id]) : null
      if (grant) return { refused: grant }
      const rank = await membershipChangesRefusal(tx, ctx, { added, removed })
      if (rank) return { refused: rank }
      await setTeamMembers(tx, team.id, userIds)
      return { team: await tx.team.findUniqueOrThrow({ where: { id: team.id }, select: teamSelect }) }
    })
    if ("refused" in saved) return apiError(saved.refused.status, saved.refused.error, saved.refused.code)
    return NextResponse.json(toTeamResponse(saved.team, ctx))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving team members")
    return apiError(status, message)
  }
}
