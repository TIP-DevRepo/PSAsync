// How a team's default roles combine with a user's own roles, and who may
// hand them out. No database imports, so the permission resolver, the
// Teams routes, and Manage Users all share one rule.
//
// A user's effective roles are their directly given roles plus the default
// roles of every team they are in, worked out each time permissions are
// resolved (getEffectiveAccess). Nothing is copied into UserRole, so joining
// or leaving a team, or changing a team's default roles, applies on the very
// next request and can never get out of sync.

export interface ResolvableRole {
  id: string
  rank: number
  isGlobalAdmin: boolean
  isEveryone: boolean
}

export interface TeamWithDefaultRoles<R extends ResolvableRole> {
  team: { id: string; defaultRoles: { role: R }[] }
}

// Direct roles first, then team roles not already held, each once. The
// Everyone role never counts (every user holds it implicitly), and Global
// Admin is never taken from a team: the Teams routes refuse it as a default
// role, and this keeps it that way even for a row written some other way.
export function effectiveRoles<R extends ResolvableRole>(direct: R[], memberships: TeamWithDefaultRoles<R>[]): R[] {
  const seen = new Set<string>()
  const roles: R[] = []
  for (const role of direct) {
    if (role.isEveryone || seen.has(role.id)) continue
    seen.add(role.id)
    roles.push(role)
  }
  for (const { team } of memberships) {
    for (const { role } of team.defaultRoles) {
      if (role.isEveryone || role.isGlobalAdmin || seen.has(role.id)) continue
      seen.add(role.id)
      roles.push(role)
    }
  }
  return roles
}

// The highest rank among the roles, the same rule as getEffectiveAccess:
// Global Admin is the highest possible, no roles is 0
export function rankOf(roles: { rank: number; isGlobalAdmin: boolean }[]): number {
  if (roles.some((r) => r.isGlobalAdmin)) return Number.MAX_SAFE_INTEGER
  return roles.length > 0 ? Math.max(...roles.map((r) => r.rank)) : 0
}

// The grant rule for team default roles is the one Manage Users uses for a
// user's own roles (assignsRoleAtOrAboveRank in src/lib/user-roles.ts): every
// role must sit below the actor's rank. Setting a team's default roles, and
// adding a member to a team that has default roles, both count as granting
// those roles. Removing never needs it.
export const TEAM_ROLE_GLOBAL_ADMIN_MESSAGE = "Global Admin can't be a team's default role"
export const TEAM_ROLE_ABOVE_RANK_MESSAGE = "You can't give a team a default role at or above your own rank"
export const TEAM_MEMBER_ROLE_ABOVE_RANK_MESSAGE =
  "This team gives its members a role at or above your own rank, so you can't add members to it"
