import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { assignsRoleAtOrAboveRank, loadRolesForAssignment } from "@/lib/user-roles"
import { TEAM_MEMBER_ROLE_ABOVE_RANK_MESSAGE, TEAM_ROLE_ABOVE_RANK_MESSAGE, TEAM_ROLE_GLOBAL_ADMIN_MESSAGE } from "@/lib/team-roles"
import { visibleTeamMemberIds } from "@/lib/team-rules"
import type { TeamRow } from "@/lib/team-selects"

// Server side team helpers shared by the Teams routes and Manage Users

// One team as every Teams route returns it. members (id, name, active) only
// goes to users who manage teams. isMember says whether the caller is in it,
// and assignableOwnerIds which active members the caller may make an
// opportunity's owner in it (visibleTeamMemberIds; none without the
// Opportunities page), which is all the New opportunity dialog and the
// opportunity page need to know about membership.
export function toTeamResponse(team: TeamRow, ctx: Pick<AccessContext, "userId" | "can">) {
  const activeIds = team.members.filter((m) => m.user.active).map((m) => m.user.id)
  const assignableOwnerIds = ctx.can("pages.opportunities")
    ? visibleTeamMemberIds(
        { userId: ctx.userId, canViewAll: ctx.can("opportunities.viewAll"), canViewTeam: ctx.can("opportunities.viewTeam") },
        activeIds
      )
    : []
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    isDefault: team.isDefault,
    sortOrder: team.sortOrder,
    memberCount: team.members.length,
    defaultRoles: team.defaultRoles.map((d) => d.role),
    isMember: team.members.some((m) => m.user.id === ctx.userId),
    assignableOwnerIds,
    ...(ctx.can("settingsSections.teams") ? { members: team.members.map((m) => m.user) } : {}),
  }
}

// A list of ids from a body: distinct strings, or null for anything else
export function readIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v)) return null
  return [...new Set(value as string[])]
}

export type TeamRefusal = { status: 400 | 403; error: string; code?: string }

// Checks a team's default roles: every one a role of the company (never
// Everyone, loadRolesForAssignment), never Global Admin, and every role not
// already on the team one the actor could grant directly (below their rank,
// the Manage Users rule). Removing a role needs nothing.
export async function checkDefaultRoles(
  ctx: Pick<AccessContext, "companyId" | "access">,
  roleIds: string[],
  currentRoleIds: readonly string[] = []
): Promise<TeamRefusal | null> {
  const loaded = await loadRolesForAssignment(prisma, ctx.companyId, roleIds)
  if (loaded.error !== undefined) return { status: 400, error: loaded.error, code: "INVALID_REFERENCE" }
  if (loaded.roles.some((r) => r.isGlobalAdmin)) return { status: 400, error: TEAM_ROLE_GLOBAL_ADMIN_MESSAGE }
  const added = loaded.roles.filter((r) => !currentRoleIds.includes(r.id))
  if (assignsRoleAtOrAboveRank(added, ctx.access.rank)) return { status: 403, error: TEAM_ROLE_ABOVE_RANK_MESSAGE, code: "FORBIDDEN" }
  return null
}

// Adding someone to a team grants them its default roles, so it follows the
// same rule: refused when any of the team's default roles is at or above
// the actor's rank
export async function teamsGrantAboveRank(
  db: Prisma.TransactionClient,
  ctx: Pick<AccessContext, "companyId" | "access">,
  teamIds: string[]
): Promise<boolean> {
  if (teamIds.length === 0) return false
  const roles = await db.teamDefaultRole.findMany({
    where: { teamId: { in: teamIds }, team: { companyId: ctx.companyId } },
    select: { role: { select: { rank: true } } },
  })
  return assignsRoleAtOrAboveRank(roles.map((r) => r.role), ctx.access.rank)
}

export const MEMBER_GRANT_REFUSAL: TeamRefusal = { status: 403, error: TEAM_MEMBER_ROLE_ABOVE_RANK_MESSAGE, code: "FORBIDDEN" }

// Replaces a team's members. Callers check every added user first.
export async function setTeamMembers(tx: Prisma.TransactionClient, teamId: string, userIds: string[]) {
  await tx.teamMember.deleteMany({ where: { teamId, userId: { notIn: userIds } } })
  if (userIds.length > 0) {
    await tx.teamMember.createMany({ data: userIds.map((userId) => ({ teamId, userId })), skipDuplicates: true })
  }
}

// Replaces a team's default roles. Callers check every role first.
export async function setTeamDefaultRoles(tx: Prisma.TransactionClient, teamId: string, roleIds: string[]) {
  await tx.teamDefaultRole.deleteMany({ where: { teamId, roleId: { notIn: roleIds } } })
  if (roleIds.length > 0) {
    await tx.teamDefaultRole.createMany({ data: roleIds.map((roleId) => ({ teamId, roleId })), skipDuplicates: true })
  }
}

// Replaces the teams a user is in (Manage Users), within their company.
// Callers check every added team first.
export async function setUserTeams(tx: Prisma.TransactionClient, companyId: string, userId: string, teamIds: string[]) {
  await tx.teamMember.deleteMany({ where: { userId, team: { companyId }, teamId: { notIn: teamIds } } })
  if (teamIds.length > 0) {
    await tx.teamMember.createMany({ data: teamIds.map((teamId) => ({ teamId, userId })), skipDuplicates: true })
  }
}
