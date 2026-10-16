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
