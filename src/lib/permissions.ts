import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { usesMicrosoftSso } from "@/lib/sso-account"
import { checkAccess } from "@/lib/access-check"
import { effectiveRoles, rankOf } from "@/lib/team-roles"

// Shape of the permissions JSON stored on each Role. Kept loose (not every
// field required) since it's read with optional chaining throughout —
// this is just enough structure for autocomplete and safe nested access.
export interface RolePermissions {
  pages?: Partial<Record<"clients" | "catalog" | "vendors" | "inventory" | "quotes" | "settings" | "salesOrders" | "purchaseOrders" | "opportunities", boolean>>
  quotes?: Partial<Record<
    "create" | "edit" | "delete" | "changeStatus" | "approve" | "sendEmail" | "viewAllUsersQuotes" | "sendAsOthers",
    boolean
  >>
  clients?: Partial<Record<"create" | "edit" | "delete", boolean>>
  salesOrders?: Partial<Record<"create" | "edit" | "delete" | "changeStatus" | "generatePO" | "viewAll", boolean>>
  purchaseOrders?: Partial<Record<"create" | "edit" | "delete" | "changeStatus" | "send" | "viewAll", boolean>>
  opportunities?: Partial<Record<"create" | "edit" | "delete" | "viewTeam" | "viewAll", boolean>>
  catalog?: Partial<Record<"delete", boolean>>
  inventory?: Partial<Record<"delete", boolean>>
  settingsSections?: Partial<Record<
    "company" | "users" | "quotes" | "approvalWorkflows" | "notifications" | "integrations" | "salesOrders" | "opportunities" | "teams" | "actionButtons",
    boolean
  >>
  dashboards?: Partial<Record<"manage", boolean>>
}

// One user's resolved access across every role they hold (directly or from
// a team's default roles, src/lib/team-roles.ts) plus their company's
// Everyone role. This is the only thing permission checks read,
// server side (hasPermission, getUserRank) and client side (exposed as
// session.user.access by the session callback in src/auth.ts).
export interface EffectiveAccess {
  userId: string
  // Read from the user's database row, never from the login token, so API
  // routes scope by the company the user actually belongs to right now.
  companyId: string
  isGlobalAdmin: boolean
  // Highest rank among the user's effective roles (assigned directly or
  // by a team), Number.MAX_SAFE_INTEGER for Global Admin, 0 when they hold
  // no role (same as a user with no role before multi role support).
  // Everyone never counts here.
  rank: number
  // Union of every held role's permissions JSON: a boolean is true if any
  // role has it true, a number (maxDiscount) takes the highest value.
  permissions: RolePermissions
  // Effective role ids (direct and from teams), never including the
  // Everyone role.
  roleIds: string[]
  // The teams the user is a member of
  teamIds: string[]
  // True while the user is still on an admin's temporary password. Every
  // other field is then empty (no permissions, rank 0, no roles), so every
  // permission check refuses them until they choose their own password.
  mustChangePassword: boolean
}

// Recursively ORs booleans and maxes numbers, so any permission key added
// later is unioned across roles automatically without touching this code.
function mergePermissionsInto(target: Record<string, unknown>, source: unknown) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const current = target[key]
    if (typeof value === "boolean") {
      target[key] = current === true || value
    } else if (typeof value === "number") {
      target[key] = typeof current === "number" ? Math.max(current, value) : value
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested =
        current && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {}
      target[key] = nested
      mergePermissionsInto(nested, value)
    }
  }
}

const roleFields = { id: true, rank: true, isGlobalAdmin: true, isEveryone: true, permissions: true } as const

// Resolves a user's effective access fresh from the database (never from
// the login token), so role, permission, team membership, and team default
// role changes all apply on the very next request, with nothing cached
// between requests. Wrapped in React cache so a single server render that
// checks several permissions (layout, page, hasPermission calls) only
// queries once. Returns null for a missing or deactivated user, which every
// check treats as no access. A company with no Everyone role yet is treated
// as Everyone having no permissions.
export const getEffectiveAccess = cache(async (userId: string): Promise<EffectiveAccess | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      active: true,
      companyId: true,
      mustChangePassword: true,
      company: { select: { settings: { select: { ssoEnabled: true } } } },
      userRoles: { select: { role: { select: roleFields } } },
      // Each team's default roles count as the user's own while they are in it
      teamMemberships: {
        select: { team: { select: { id: true, companyId: true, defaultRoles: { select: { role: { select: roleFields } } } } } },
      },
    },
  })
  if (!user || !user.active) return null

  // Gated until they replace their temporary password. A company that has
  // since turned SSO on is never gated, since its users can't use or change
  // a password and would otherwise be stuck.
  if (user.mustChangePassword && !usesMicrosoftSso(user.company.settings)) {
    return {
      userId,
      companyId: user.companyId,
      isGlobalAdmin: false,
      rank: 0,
      permissions: {},
      roleIds: [],
      teamIds: [],
      mustChangePassword: true,
    }
  }

  const everyone = await prisma.role.findFirst({
    where: { companyId: user.companyId, isEveryone: true },
    select: { permissions: true },
  })

  // Only the user's own company's teams, as a guard; the Teams routes never
  // add anyone to another company's team
  const memberships = user.teamMemberships.filter((m) => m.team.companyId === user.companyId)
  const assigned = effectiveRoles(user.userRoles.map((ur) => ur.role), memberships)

  // Global Admin has access to everything, unconditionally, before the
  // permissions JSON is even looked at. This is what guarantees any
  // permission added later is automatically covered without remembering
  // to update this role's JSON.
  const isGlobalAdmin = assigned.some((r) => r.isGlobalAdmin)

  const permissions: Record<string, unknown> = {}
  mergePermissionsInto(permissions, everyone?.permissions)
  for (const role of assigned) mergePermissionsInto(permissions, role.permissions)

  const rank = rankOf(assigned)

  return {
    userId,
    companyId: user.companyId,
    isGlobalAdmin,
    rank,
    permissions: permissions as RolePermissions,
    roleIds: assigned.map((r) => r.id),
    teamIds: memberships.map((m) => m.team.id),
    mustChangePassword: false,
  }
})

// Dot-path permission check, e.g. hasPermission(userId, "quotes.delete") or
// hasPermission(userId, "settingsSections.users"). True if any role the user
// holds (including Everyone) allows it, or if they hold Global Admin.
export async function hasPermission(userId: string, path: string): Promise<boolean> {
  return checkAccess(await getEffectiveAccess(userId), path)
}

// Lives in its own module so client components can import it without
// pulling in the database client
export { checkAccess }

// The user's highest rank across every role they hold, for "X or higher"
// comparisons like approval workflow requirements and the users/roles
// hierarchy rules. Returns 0 if the user has no assigned role. Global Admin
// always reports the highest possible rank, regardless of the numeric rank
// stored on the role.
export async function getUserRank(userId: string): Promise<number> {
  const access = await getEffectiveAccess(userId)
  return access?.rank ?? 0
}

// A few call sites (dashboard nav, dashboard widget gating) read the
// effective pages permissions directly instead of going through
// hasPermission, for a plain object they can filter/map over. This gives
// those call sites the same Global Admin bypass (an all-true pages object)
// without each one needing to know about isGlobalAdmin itself.
export function resolvePagePermissions(
  access: { isGlobalAdmin?: boolean; permissions?: unknown } | null | undefined
): Required<NonNullable<RolePermissions["pages"]>> {
  if (access?.isGlobalAdmin) {
    return {
      clients: true,
      catalog: true,
      vendors: true,
      inventory: true,
      quotes: true,
      settings: true,
      salesOrders: true,
      purchaseOrders: true,
      opportunities: true,
    }
  }
  const pages = (access?.permissions as RolePermissions | undefined)?.pages
  return {
    clients: !!pages?.clients,
    catalog: !!pages?.catalog,
    vendors: !!pages?.vendors,
    inventory: !!pages?.inventory,
    quotes: !!pages?.quotes,
    settings: !!pages?.settings,
    salesOrders: !!pages?.salesOrders,
    purchaseOrders: !!pages?.purchaseOrders,
    opportunities: !!pages?.opportunities,
  }
}
