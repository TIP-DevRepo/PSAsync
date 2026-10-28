// The one rule for giving a role to someone: directly (inviting a user,
// changing a user's roles in Manage Users) or through a team (attaching it
// as a team's default role, or adding a member to a team that has it). The
// acting user must rank above the role (assignsRoleAtOrAboveRank, the
// Manage Users rank rule) AND hold, through their own effective roles,
// every permission the role grants (findPermissionEscalations, the Roles
// screen rule), so nobody can hand out, or take for themselves, access they
// don't have. Global Admin holds everything, so always passes. Removing a
// role or a member is never restricted by this rule.
//
// No database imports, so the routes and the screens share it.

import type { EffectiveAccess } from "@/lib/permissions"
import { findPermissionEscalations, validateRolePermissions } from "@/lib/role-permission-rules"
import { assignsRoleAtOrAboveRank, ROLE_AT_OR_ABOVE_RANK_MESSAGE } from "@/lib/user-roles"
import { TEAM_MEMBER_ROLE_ABOVE_RANK_MESSAGE, TEAM_ROLE_ABOVE_RANK_MESSAGE } from "@/lib/team-roles"

export interface GrantRole {
  name: string
  rank: number
  // The role's stored permissions JSON
  permissions: unknown
}

export type GrantActor = Pick<EffectiveAccess, "isGlobalAdmin" | "rank" | "permissions">

export interface GrantRefusal {
  role: GrantRole
  reason: "rank" | "permissions"
}

// The first role in the list the actor may not give, or null when they may
// give every one. A rank refusal is reported before a permission one.
export function roleGrantRefusal(actor: GrantActor, roles: readonly GrantRole[]): GrantRefusal | null {
  if (actor.isGlobalAdmin) return null
  const aboveRank = roles.find((role) => assignsRoleAtOrAboveRank([role], actor.rank))
  if (aboveRank) return { role: aboveRank, reason: "rank" }
  const beyondPermissions = roles.find((role) => {
    // Legacy keys a stored role may still hold are dropped, as a role save does
    const validated = validateRolePermissions(role.permissions)
    const permissions = validated.error === undefined ? validated.permissions : {}
    return findPermissionEscalations(actor as EffectiveAccess, {}, permissions).length > 0
  })
  return beyondPermissions ? { role: beyondPermissions, reason: "permissions" } : null
}

// Where the role is being given, for the message
export type GrantContext = "user" | "teamRole" | "teamMember"

export function roleGrantMessage(refusal: GrantRefusal, context: GrantContext): string {
  if (refusal.reason === "rank") {
    return context === "user" ? ROLE_AT_OR_ABOVE_RANK_MESSAGE : context === "teamRole" ? TEAM_ROLE_ABOVE_RANK_MESSAGE : TEAM_MEMBER_ROLE_ABOVE_RANK_MESSAGE
  }
  return context === "teamMember"
    ? `You can't add members to this team because its ${refusal.role.name} role includes permissions you don't have`
    : `You can't give the ${refusal.role.name} role because it includes permissions you don't have`
}

// The message for the first refused role, or null when every role may be given
export function roleGrantProblem(actor: GrantActor, roles: readonly GrantRole[], context: GrantContext): string | null {
  const refusal = roleGrantRefusal(actor, roles)
  return refusal ? roleGrantMessage(refusal, context) : null
}
