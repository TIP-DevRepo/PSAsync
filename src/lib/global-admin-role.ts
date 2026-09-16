import type { Prisma } from "@/generated/prisma"

// Rank chosen high enough to outrank any role a company could realistically
// create, so it always wins "X or higher" comparisons (approval workflows,
// etc). getUserRank() in permissions.ts still special-cases isGlobalAdmin
// directly, so this number is a belt-and-suspenders default, not the only
// thing enforcing "highest rank."
export const GLOBAL_ADMIN_RANK = 999999
export const GLOBAL_ADMIN_ROLE_NAME = "Global Admin"

// Every key currently known to the permissions JSON, set true here purely
// so the Roles & Permissions UI shows an honest picture of this role's
// access. The real enforcement is the isGlobalAdmin check in hasPermission,
// which bypasses this object entirely, so a permission added later without
// updating this object is still granted to Global Admin.
export function buildGlobalAdminPermissions(): Prisma.InputJsonValue {
  return {
    pages: {
      clients: true,
      catalog: true,
      vendors: true,
      inventory: true,
      quotes: true,
      settings: true,
      salesOrders: true,
      purchaseOrders: true,
    },
    quotes: {
      create: true,
      edit: true,
      delete: true,
      changeStatus: true,
      approve: true,
      sendEmail: true,
      viewAllUsersQuotes: true,
    },
    clients: { create: true, edit: true, delete: true, viewAllClients: true },
    salesOrders: { create: true, edit: true, delete: true, changeStatus: true, generatePO: true, viewAll: true },
    purchaseOrders: { create: true, edit: true, delete: true, changeStatus: true, send: true, viewAll: true },
    settingsSections: {
      company: true,
      users: true,
      quotes: true,
      approvalWorkflows: true,
      notifications: true,
      integrations: true,
      salesOrders: true,
    },
    dashboards: { manage: true },
    maxDiscount: 100,
  }
}

// Creates the one locked Global Admin role for a company. Callers must run
// this inside a transaction alongside the Company.create() (or, for the
// one-time backfill, guard it with a findFirst check). The partial unique
// index on Role(companyId) WHERE isGlobalAdmin is what stops a second one
// from ever existing, this helper doesn't check for an existing row itself.
export function globalAdminRoleData(companyId: string): Prisma.RoleCreateManyInput {
  return {
    companyId,
    name: GLOBAL_ADMIN_ROLE_NAME,
    rank: GLOBAL_ADMIN_RANK,
    isSystem: true,
    isGlobalAdmin: true,
    permissions: buildGlobalAdminPermissions(),
  }
}
