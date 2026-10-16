import type { EffectiveAccess, RolePermissions } from "@/lib/permissions"

// The pure check behind hasPermission, requireAccess's ctx.can, and the
// client side useAccess hook, so the Global Admin bypass lives in exactly
// one place. Kept free of database imports so client components can use
// it. Null access (a missing or deactivated user) is always refused.
export function checkAccess(access: EffectiveAccess | null | undefined, path: string): boolean {
  if (!access) return false
  if (access.isGlobalAdmin) return true

  const [section, key] = path.split(".") as [keyof RolePermissions, string]
  const sectionObj = access.permissions[section] as Record<string, boolean> | undefined
  return !!sectionObj?.[key]
}

// Holding any one of these lets a user see line item cost and the margins
// worked out from it: they maintain the catalog or edit quotes, sales
// orders, or purchase orders. Shared by the API's canSeeCost and the UI.
export const COST_PERMISSIONS = ["pages.catalog", "quotes.edit", "salesOrders.edit", "purchaseOrders.edit"] as const

export function canSeeCostWith(can: (path: string) => boolean): boolean {
  return COST_PERMISSIONS.some((p) => can(p))
}
