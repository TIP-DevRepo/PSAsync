import { prisma } from "@/lib/prisma"

// Shape of the permissions JSON stored on each Role. Kept loose (not every
// field required) since it's read with optional chaining throughout —
// this is just enough structure for autocomplete and safe nested access.
export interface RolePermissions {
  pages?: Partial<Record<"clients" | "catalog" | "vendors" | "quotes" | "settings" | "salesOrders" | "purchaseOrders", boolean>>
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

  const permissions = user?.role?.permissions as RolePermissions | undefined
  if (!permissions) return false

  const [section, key] = path.split(".") as [keyof RolePermissions, string]
  const sectionObj = permissions[section] as Record<string, boolean> | undefined
  return !!sectionObj?.[key]
}

// Fetches the current user's role rank, for "X or higher" comparisons like
// approval workflow requirements. Returns 0 if the user has no role.
export async function getUserRank(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  })
  return user?.role?.rank ?? 0
}