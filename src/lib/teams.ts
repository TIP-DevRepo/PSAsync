import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"
import { loadRolesForAssignment } from "@/lib/user-roles"
import { effectiveRoles, membershipChangeRefusal, rankOf, TEAM_ROLE_GLOBAL_ADMIN_MESSAGE } from "@/lib/team-roles"
import { roleGrantProblem } from "@/lib/role-grants"
import { visibleTeamMemberIds } from "@/lib/team-rules"
import type { TeamRow } from "@/lib/team-selects"

// Server side team helpers shared by the Teams routes and Manage Users

// One team as every Teams route returns it. members (id, name, active) only
// goes to users who manage teams. isMember says whether the caller is in it,
// and assignableOwnerIds which active members the caller may make an
// opportunity's owner in it (visibleTeamMemberIds; none without the
// Opportunities page), which is all the New opportunity dialog and the
// opportunity page need to know about membership. For users who manage
// teams, memberGrantRefusal says why they can't add members (one of its
// default roles fails the grant rule, src/lib/role-grants.ts), or null.
// Role permissions are read for that check and never returned.
export function toTeamResponse(team: TeamRow, ctx: Pick<AccessContext, "userId" | "can" | "access">) {
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
    defaultRoles: team.defaultRoles.map(({ role }) => ({ id: role.id, name: role.name, rank: role.rank, color: role.color, isGlobalAdmin: role.isGlobalAdmin })),
    isMember: team.members.some((m) => m.user.id === ctx.userId),
    assignableOwnerIds,
    ...(ctx.can("settingsSections.teams")
      ? {
          members: team.members.map((m) => m.user),
          memberGrantRefusal: roleGrantProblem(ctx.access, team.defaultRoles.map((d) => d.role), "teamMember"),
        }
      : {}),
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
// already on the team one the actor could give directly (the grant rule,
// roleGrantProblem: below their rank and every permission held). Removing a
// role needs nothing.
export async function checkDefaultRoles(
  ctx: Pick<AccessContext, "companyId" | "access">,
  roleIds: string[],
  currentRoleIds: readonly string[] = []
): Promise<TeamRefusal | null> {
  const loaded = await loadRolesForAssignment(prisma, ctx.companyId, roleIds)
  if (loaded.error !== undefined) return { status: 400, error: loaded.error, code: "INVALID_REFERENCE" }
  if (loaded.roles.some((r) => r.isGlobalAdmin)) return { status: 400, error: TEAM_ROLE_GLOBAL_ADMIN_MESSAGE }
  const added = loaded.roles.filter((r) => !currentRoleIds.includes(r.id))
  const problem = roleGrantProblem(ctx.access, added, "teamRole")
  return problem ? { status: 403, error: problem, code: "FORBIDDEN" } : null
}

// Adding someone to a team gives them its default roles, so it follows the
// same grant rule: a 403 refusal naming the first of the teams' default
// roles the actor couldn't give, or null
export async function teamsGrantRefusal(
  db: Prisma.TransactionClient,
  ctx: Pick<AccessContext, "companyId" | "access">,
  teamIds: string[]
): Promise<TeamRefusal | null> {
  if (teamIds.length === 0) return null
  const roles = await db.teamDefaultRole.findMany({
    where: { teamId: { in: teamIds }, team: { companyId: ctx.companyId } },
    select: { role: { select: { name: true, rank: true, permissions: true } } },
  })
  const problem = roleGrantProblem(ctx.access, roles.map((r) => r.role), "teamMember")
  return problem ? { status: 403, error: problem, code: "FORBIDDEN" } : null
}

// Each user's effective rank (direct roles plus their teams' default roles,
// rankOf), the rank the Manage Users hierarchy compares. Users of another
// company are left out.
export async function loadEffectiveRanks(db: Prisma.TransactionClient, companyId: string, userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()
  const role = { select: { id: true, rank: true, isGlobalAdmin: true, isEveryone: true } } as const
  const users = await db.user.findMany({
    where: { id: { in: userIds }, companyId },
    select: {
      id: true,
      userRoles: { select: { role } },
      teamMemberships: { where: { team: { companyId } }, select: { team: { select: { id: true, defaultRoles: { select: { role } } } } } },
    },
  })
  return new Map(users.map((u) => [u.id, rankOf(effectiveRoles(u.userRoles.map((ur) => ur.role), u.teamMemberships))]))
}

// The membership rank rule (membershipChangeRefusal) for every user added
// to or removed from a team: a 403 refusal, or null
export async function membershipChangesRefusal(
  db: Prisma.TransactionClient,
  ctx: Pick<AccessContext, "companyId" | "userId" | "access">,
  changes: { added: string[]; removed: string[] }
): Promise<TeamRefusal | null> {
  const ranks = await loadEffectiveRanks(db, ctx.companyId, [...changes.added, ...changes.removed])
  const actor = { userId: ctx.userId, rank: ctx.access.rank, isGlobalAdmin: ctx.access.isGlobalAdmin }
  for (const [ids, change] of [[changes.added, "add"], [changes.removed, "remove"]] as const) {
    for (const id of ids) {
      const problem = membershipChangeRefusal(actor, { id, rank: ranks.get(id) ?? 0 }, change)
      if (problem) return { status: 403, error: problem, code: "FORBIDDEN" }
    }
  }
  return null
}

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
