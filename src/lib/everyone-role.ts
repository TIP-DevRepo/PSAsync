import type { Prisma } from "@/generated/prisma"

export const EVERYONE_ROLE_NAME = "Everyone"

// Every section the Roles & Permissions panel edits, all false. Same shape
// as DEFAULT_PERMISSIONS in src/app/api/roles/route.ts, so the panel can
// render the Everyone role like any other role.
function buildNoPermissions(): Prisma.InputJsonValue {
  return {
    pages: { clients: false, catalog: false, vendors: false, inventory: false, quotes: false, settings: false, salesOrders: false, purchaseOrders: false },
    quotes: { create: false, edit: false, delete: false, changeStatus: false, approve: false, sendEmail: false, viewAllUsersQuotes: false },
    clients: { create: false, edit: false, delete: false, viewAllClients: false },
    salesOrders: { create: false, edit: false, delete: false, changeStatus: false, generatePO: false, viewAll: false },
    purchaseOrders: { create: false, edit: false, delete: false, changeStatus: false, send: false },
    catalog: { delete: false },
    inventory: { delete: false },
    settingsSections: { company: false, users: false, quotes: false, approvalWorkflows: false, notifications: false, integrations: false, salesOrders: false },
    dashboards: { manage: false },
  }
}

// The Everyone role is the implicit base role every user in a company holds
// without a UserRole row. It starts with no permissions so creating it never
// grants anyone access, and sits one below the company's lowest existing
// role (never above -1) so it is always the lowest rank.
export function everyoneRoleData(companyId: string, rank: number): Prisma.RoleCreateManyInput {
  return {
    companyId,
    name: EVERYONE_ROLE_NAME,
    rank,
    isSystem: true,
    isGlobalAdmin: false,
    isEveryone: true,
    permissions: buildNoPermissions(),
  }
}

// Returns the company's Everyone role, creating it on demand if it doesn't
// exist yet (new companies, or anything the migration backfill missed). The
// partial unique index on Role(companyId) WHERE isEveryone stops a second
// one from ever existing, so losing a race just means using the winner's.
export async function ensureEveryoneRole(db: Prisma.TransactionClient, companyId: string) {
  const existing = await db.role.findFirst({ where: { companyId, isEveryone: true } })
  if (existing) return existing

  const lowest = await db.role.aggregate({ where: { companyId }, _min: { rank: true } })
  const rank = Math.min(0, lowest._min.rank ?? 0) - 1

  try {
    return await db.role.create({ data: everyoneRoleData(companyId, rank) })
  } catch (err) {
    const raced = await db.role.findFirst({ where: { companyId, isEveryone: true } })
    if (raced) return raced
    throw err
  }
}
