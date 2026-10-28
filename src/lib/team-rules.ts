// The rules teams share between the server and the screens: field limits,
// messages, and who a user may see or pick in a team. No React and no
// database imports, so pages, routes, and checks can all use them.

import { sortUsersByName } from "@/lib/user-picker"

export const TEAM_NAME_MAX = 100
export const TEAM_DESCRIPTION_MAX = 500

export const TEAM_NAME_TAKEN_MESSAGE = "A team with that name already exists"
export const DEFAULT_TEAM_DELETE_MESSAGE = "The General team can't be deleted. You can rename it."
export const TEAM_ORDER_MESSAGE = "Invalid team order"
export const TEAM_ORDER_STALE_MESSAGE = "The team list changed since you loaded it. Refresh and try again."

export function teamInUseMessage(count: number): string {
  return `This team has ${count} ${count === 1 ? "opportunity" : "opportunities"}. Move ${count === 1 ? "it" : "them"} to another team before deleting it.`
}

// What the viewer may do with opportunities, from their permissions
export interface OpportunityTeamViewer {
  userId: string
  canViewAll: boolean
  canViewTeam: boolean
}

// The members of a team a viewer may see in the sidebar and choose as an
// opportunity's owner in that team (the owner rule): every member with
// opportunities.viewAll, every member of a team they are in with
// opportunities.viewTeam, otherwise only themselves when they are in it.
// memberIds should hold active members only.
export function visibleTeamMemberIds(viewer: OpportunityTeamViewer, memberIds: readonly string[]): string[] {
  const isMember = memberIds.includes(viewer.userId)
  if (viewer.canViewAll || (viewer.canViewTeam && isMember)) return [...memberIds]
  return isMember ? [viewer.userId] : []
}

export const TEAM_NOT_MEMBER_MESSAGE = "You can only move opportunities to teams you belong to"
export const OWNER_NOT_IN_TEAM_MESSAGE = "Owner is not in this team"
export const TEAM_CHANGE_OWNER_MESSAGE =
  "The owner is not in the new team. Choose an owner from that team or leave the opportunity unassigned."

// ─── Sidebar counts ─────────────────────────────────────────────────────────

export interface SidebarMemberCount {
  id: string
  name: string
  count: number
}

export interface SidebarTeamCount {
  id: string
  name: string
  isDefault: boolean
  // Every open opportunity in the team the viewer can see
  count: number
  unassigned: number
  // The members the viewer may see (visibleTeamMemberIds), by name
  members: SidebarMemberCount[]
}

export interface SidebarCounts {
  // Every open opportunity the viewer can see, in any team
  total: number
  teams: SidebarTeamCount[]
}

// Builds GET /api/opportunities/sidebar-counts from the teams the viewer may
// list (in order, with their active members) and the open opportunities the
// viewer can see, grouped by team and owner
export function sidebarCounts(
  viewer: OpportunityTeamViewer,
  teams: readonly { id: string; name: string; isDefault: boolean; members: readonly { id: string; name: string }[] }[],
  groups: readonly { teamId: string | null; ownerId: string | null; count: number }[]
): SidebarCounts {
  const sum = (rows: readonly { count: number }[]) => rows.reduce((total, row) => total + row.count, 0)
  return {
    total: sum(groups),
    teams: teams.map((team) => {
      const inTeam = groups.filter((g) => g.teamId === team.id)
      const visible = new Set(visibleTeamMemberIds(viewer, team.members.map((m) => m.id)))
      return {
        id: team.id,
        name: team.name,
        isDefault: team.isDefault,
        count: sum(inTeam),
        unassigned: sum(inTeam.filter((g) => g.ownerId === null)),
        members: sortUsersByName(team.members.filter((m) => visible.has(m.id))).map((m) => ({
          id: m.id,
          name: m.name,
          count: sum(inTeam.filter((g) => g.ownerId === m.id)),
        })),
      }
    }),
  }
}

// ─── Screens ────────────────────────────────────────────────────────────────

export interface TeamRole {
  id: string
  name: string
  rank: number
  color: string | null
  isGlobalAdmin: boolean
  // GET /api/roles only: why the signed in user can't give this role (the
  // grant rule, src/lib/role-grants.ts), or null
  grantRefusal?: string | null
}

// One team as GET /api/teams returns it (toTeamResponse in src/lib/teams.ts)
export interface TeamSummary {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  sortOrder: number
  memberCount: number
  defaultRoles: TeamRole[]
  // Whether the signed in user is in it
  isMember: boolean
  // The active members the signed in user may make an opportunity's owner
  // in this team (visibleTeamMemberIds)
  assignableOwnerIds: string[]
  // Only for users who manage teams
  members?: { id: string; name: string; active: boolean }[]
  // Only for users who manage teams: why they can't add members (one of its
  // default roles fails the grant rule), or null
  memberGrantRefusal?: string | null
}

// Why a role can't be added as a team's default role, or null when it can:
// Global Admin never, and otherwise the grant rule's reason from GET
// /api/roles. A role already on the team can always be kept or removed.
export function defaultRoleBlockReason(role: Pick<TeamRole, "isGlobalAdmin" | "grantRefusal">, alreadyOnTeam: boolean): string | null {
  if (role.isGlobalAdmin) return "Global Admin can't be a team's default role"
  if (!alreadyOnTeam && role.grantRefusal) return role.grantRefusal
  return null
}

// Why new members can't be added to a team with these default roles, or
// null when they can (adding a member gives them the team's roles, so each
// must pass the grant rule)
export function addMemberBlockReason(roles: readonly Pick<TeamRole, "name" | "grantRefusal">[]): string | null {
  const blocked = roles.find((r) => r.grantRefusal)
  return blocked ? `This team gives the ${blocked.name} role, which you can't give` : null
}

// Why a user can't be added to or removed from a team by the signed in user
// (the membership rank rule, teamChangeRefusal from GET /api/users), or
// null. Anyone may remove themselves.
export function memberChangeBlockReason(
  user: { id: string; teamChangeRefusal?: string | null },
  myUserId: string | null,
  change: "add" | "remove"
): string | null {
  if (change === "remove" && user.id === myUserId) return null
  return user.teamChangeRefusal ?? null
}
