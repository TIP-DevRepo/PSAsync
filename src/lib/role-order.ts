import type { Prisma } from "@/generated/prisma"
import { syncLegacyRoleId } from "@/lib/user-roles"

// A company's regular roles (everything except Global Admin, pinned at the
// top, and Everyone, pinned at the bottom), highest rank first. Roles that
// share a rank are ordered oldest first. This is exactly the order the
// Roles & Permissions panel shows, so the order an admin sees before
// dragging is the order that gets saved.
export async function getRegularRolesInOrder(db: Prisma.TransactionClient, companyId: string) {
  return db.role.findMany({
    where: { companyId, isGlobalAdmin: false, isEveryone: false },
    orderBy: [{ rank: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, rank: true },
  })
}

// Renumbers a company's regular roles so orderedIds[0] is the highest: ranks
// run N down to 1, leaving Global Admin (999999) above and Everyone (below 1)
// beneath. Only roles whose rank actually changes are written. Every user
// holding a renumbered role gets their legacy User.roleId re-synced, since
// which of their roles is highest can change. Must run inside a transaction.
export async function applyRegularRoleOrder(
  db: Prisma.TransactionClient,
  companyId: string,
  orderedIds: string[],
  currentRanks: Map<string, number>
) {
  const changed: string[] = []
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]
    const rank = orderedIds.length - i
    if (currentRanks.get(id) !== rank) {
      await db.role.update({ where: { id }, data: { rank } })
      changed.push(id)
    }
  }

  // Everyone always stays below every regular role
  await db.role.updateMany({ where: { companyId, isEveryone: true, rank: { gte: 1 } }, data: { rank: 0 } })

  if (changed.length > 0) {
    const holders = await db.userRole.findMany({
      where: { roleId: { in: changed } },
      select: { userId: true },
      distinct: ["userId"],
    })
    await syncLegacyRoleId(db, holders.map((h) => h.userId))
  }

  return changed
}
