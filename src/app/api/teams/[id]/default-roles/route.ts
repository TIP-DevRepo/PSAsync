import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { assertRefs, loadTeam } from "@/lib/scoped-loaders"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { teamSelect } from "@/lib/team-selects"
import { checkDefaultRoles, readIdList, setTeamDefaultRoles, toTeamResponse } from "@/lib/teams"
import { readJsonObject } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"

// Replaces the team's default roles with roleIds: roles of the company,
// never Everyone or Global Admin. A role not already on the team is granted
// to every member, so it is refused (403) unless the caller could grant it
// directly (below their own rank). Removing a role needs nothing more than
// managing teams. Members gain or lose the roles on their next request.
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
  const roleIds = readIdList(body?.roleIds)
  if (roleIds === null) return apiError(400, "Invalid role", "INVALID_REFERENCE")

  const invalid = await assertRefs(ctx, { roleId: roleIds })
  if (invalid) return invalid

  const current = await prisma.teamDefaultRole.findMany({ where: { teamId: team.id }, select: { roleId: true } })
  const refused = await checkDefaultRoles(ctx, roleIds, current.map((r) => r.roleId))
  if (refused) return apiError(refused.status, refused.error, refused.code)

  try {
    const saved = await prisma.$transaction(async (tx) => {
      await setTeamDefaultRoles(tx, team.id, roleIds)
      return tx.team.findUniqueOrThrow({ where: { id: team.id }, select: teamSelect })
    })
    return NextResponse.json(toTeamResponse(saved, ctx))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving team default roles")
    return apiError(status, message)
  }
}
