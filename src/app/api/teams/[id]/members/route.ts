import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadTeam } from "@/lib/scoped-loaders"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { teamSelect } from "@/lib/team-selects"
import { MEMBER_GRANT_REFUSAL, readIdList, setTeamMembers, teamsGrantAboveRank, toTeamResponse } from "@/lib/teams"
import { readJsonObject } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"

// Replaces the team's members with userIds. Every added user must be an
// active user of the company, and adding anyone to a team with default
// roles counts as granting those roles, so it is refused (403) unless the
// caller could grant each of them directly. Members already in the team
// stay (even if deactivated since) and removing members needs nothing more
// than managing teams. Changes apply on each member's next request.
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

  // Every id a user of the company, and every added one active
  const invalid = await assertRefs(ctx, { companyUserId: userIds, userId: added })
  if (invalid) return invalid

  try {
    const saved = await prisma.$transaction(async (tx) => {
      // Read with the write, so a default role added in the meantime counts
      if (added.length > 0 && (await teamsGrantAboveRank(tx, ctx, [team.id]))) return null
      await setTeamMembers(tx, team.id, userIds)
      return tx.team.findUniqueOrThrow({ where: { id: team.id }, select: teamSelect })
    })
    if (!saved) return apiError(MEMBER_GRANT_REFUSAL.status, MEMBER_GRANT_REFUSAL.error, MEMBER_GRANT_REFUSAL.code)
    return NextResponse.json(toTeamResponse(saved, ctx))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving team members")
    return apiError(status, message)
  }
}
