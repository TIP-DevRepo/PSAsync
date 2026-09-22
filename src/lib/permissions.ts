import { prisma } from "@/lib/prisma"

// Shape of the permissions JSON stored on each Role. Kept loose (not every
// field required) since it's read with optional chaining throughout —
// this is just enough structure for autocomplete and safe nested access.
export interface RolePermissions {
  pages?: Partial<Record<"clients" | "catalog" | "vendors" | "inventory" | "quotes" | "settings" | "salesOrders" | "purchaseOrders", boolean>>
  quotes?: Partial<Record<
    "create" | "edit" | "delete" | "changeStatus" | "approve" | "sendEmail" | "viewAllUsersQuotes",
    boolean
  >>
  clients?: Partial<Record<"create" | "edit" | "delete" | "viewAllClients", boolean>>
  salesOrders?: Partial<Record<"create" | "edit" | "delete" | "changeStatus" | "generatePO" | "viewAll", boolean>>
  purchaseOrders?: Partial<Record<"create" | "edit" | "delete" | "changeStatus" | "send" | "viewAll", boolean>>
  settingsSections?: Partial<Record<
    "company" | "users" | "quotes" | "approvalWorkflows" | "notifications" | "integrations" | "salesOrders",
    boolean
  >>
  dashboards?: Partial<Record<"manage", boolean>>
}

// Dot-path permission check, e.g. hasPermission(userId, "quotes.delete") or
// hasPermission(userId, "settingsSections.users"). Looks up the user's role
// fresh from the database each call rather than trusting the session token,
// since role/permission edits don't propagate to an already-issued session
// until the user logs back in.
export async function hasPermission(userId: string, path: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  })

  // Global Admin has access to everything, unconditionally, before the
  // permissions JSON is even looked at. This is what guarantees any
  // permission added later is automatically covered without remembering
  // to update this role's JSON.
  if (user?.role?.isGlobalAdmin) return true

  const permissions = user?.role?.permissions as RolePermissions | undefined
  if (!permissions) return false

  const [section, key] = path.split(".") as [keyof RolePermissions, string]
  const sectionObj = permissions[section] as Record<string, boolean> | undefined
  return !!sectionObj?.[key]
}

// Fetches the current user's role rank, for "X or higher" comparisons like
// approval workflow requirements. Returns 0 if the user has no role.
// Global Admin always reports the highest possible rank, regardless of the
// numeric rank stored on the role.
export async function getUserRank(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  })
  if (user?.role?.isGlobalAdmin) return Number.MAX_SAFE_INTEGER
  return user?.role?.rank ?? 0
}

// A few call sites (dashboard nav, dashboard widget gating) read
// role.permissions.pages directly instead of going through hasPermission,
// for a plain object they can filter/map over. This gives those call
// sites the same Global Admin bypass (an all-true pages object) without
// each one needing to know about isGlobalAdmin itself.
export function resolvePagePermissions(
  role: { isGlobalAdmin?: boolean; permissions?: unknown } | null | undefined
): Required<NonNullable<RolePermissions["pages"]>> {
  if (role?.isGlobalAdmin) {
    return {
      clients: true,
      catalog: true,
      vendors: true,
      inventory: true,
      quotes: true,
      settings: true,
      salesOrders: true,
      purchaseOrders: true,
    }
  }
  const pages = (role?.permissions as RolePermissions | undefined)?.pages
  return {
    clients: !!pages?.clients,
    catalog: !!pages?.catalog,
    vendors: !!pages?.vendors,
    inventory: !!pages?.inventory,
    quotes: !!pages?.quotes,
    settings: !!pages?.settings,
    salesOrders: !!pages?.salesOrders,
    purchaseOrders: !!pages?.purchaseOrders,
  }
}