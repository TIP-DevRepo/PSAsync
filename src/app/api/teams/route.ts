import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { TEAM_ORDER, teamSelect } from "@/lib/team-selects"
import { TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX, TEAM_NAME_TAKEN_MESSAGE } from "@/lib/team-rules"
import { checkDefaultRoles, readIdList, setTeamDefaultRoles, setTeamMembers, toTeamResponse } from "@/lib/teams"
import { INVALID_BODY_MESSAGE, isPrismaError, readJsonObject, readText } from "@/lib/opportunity-rules"
import { userFacingError } from "@/lib/user-error"

// Every team of the company in order, with its member count and default
// roles (toTeamResponse). Read by Settings > Teams, Manage Users, and the
// Opportunities screens; the member list itself only goes to users who
// manage teams.
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: ["settingsSections.teams", "pages.opportunities", "pages.settings"],
    message: "You do not have permission to view teams",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const teams = await prisma.team.findMany({ where: { companyId: ctx.companyId }, select: teamSelect, orderBy: TEAM_ORDER })
  return NextResponse.json(teams.map((team) => toTeamResponse(team, ctx)))
}

// A new team goes at the end of the order. memberIds and defaultRoleIds are
// optional and follow the same rules as the members and default roles
// routes: active users of the company, and default roles the creator could
// grant directly.
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.teams",
    message: "You do not have permission to manage teams",
  })
  if (response) return response

  await ensureTeamDefaults(ctx.companyId)

  const body = await readJsonObject(req)
  if (!body) return apiError(400, INVALID_BODY_MESSAGE)

  const name = readText(body.name, { label: "Team name", max: TEAM_NAME_MAX, required: true })
  if (name.error !== undefined) return apiError(400, name.error)
  const description = readText(body.description, { label: "Description", max: TEAM_DESCRIPTION_MAX })
  if (description.error !== undefined) return apiError(400, description.error)

  const memberIds = body.memberIds === undefined ? [] : readIdList(body.memberIds)
  if (memberIds === null) return apiError(400, "Invalid user", "INVALID_REFERENCE")
  const roleIds = body.defaultRoleIds === undefined ? [] : readIdList(body.defaultRoleIds)
  if (roleIds === null) return apiError(400, "Invalid role", "INVALID_REFERENCE")

  const invalid = await assertRefs(ctx, { userId: memberIds })
  if (invalid) return invalid
  const refused = await checkDefaultRoles(ctx, roleIds)
  if (refused) return apiError(refused.status, refused.error, refused.code)

  const companyId = ctx.companyId
  const duplicate = await prisma.team.findFirst({
    where: { companyId, name: { equals: name.value as string, mode: "insensitive" } },
    select: { id: true },
  })
  if (duplicate) return apiError(400, TEAM_NAME_TAKEN_MESSAGE)

  try {
    const team = await prisma.$transaction(async (tx) => {
      const last = await tx.team.aggregate({ where: { companyId }, _max: { sortOrder: true } })
      const created = await tx.team.create({
        data: { companyId, name: name.value as string, description: description.value, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select: { id: true },
      })
      await setTeamMembers(tx, created.id, memberIds)
      await setTeamDefaultRoles(tx, created.id, roleIds)
      return tx.team.findUniqueOrThrow({ where: { id: created.id }, select: teamSelect })
    })
    return NextResponse.json(toTeamResponse(team, ctx))
  } catch (err) {
    // Another request took the name in the meantime
    if (isPrismaError(err, "P2002")) return apiError(400, TEAM_NAME_TAKEN_MESSAGE)
    const { message, status } = userFacingError(err, "Creating a team")
    return apiError(status, message)
  }
}
