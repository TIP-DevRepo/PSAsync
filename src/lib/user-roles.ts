import type { Prisma } from "@/generated/prisma"

// Reads the role assignment from a users API request body. roleIds (a list
// that replaces the user's full set) is the new shape. roleId (one id, or
// "" / null for no role) is the existing single role dropdown's shape and is
// mapped to a one item (or empty) list. Returns undefined when the body
// doesn't touch roles at all, and null when it's malformed.
export function readRoleIdsFromBody(body: { roleIds?: unknown; roleId?: unknown }): string[] | null | undefined {
  if (body.roleIds !== undefined) {
    if (!Array.isArray(body.roleIds) || !body.roleIds.every((r) => typeof r === "string" && r)) return null
    return [...new Set(body.roleIds as string[])]
  }
  if (body.roleId !== undefined) {
    if (body.roleId === null || body.roleId === "") return []
    if (typeof body.roleId !== "string") return null
    return [body.roleId]
  }
  return undefined
}

// Loads the roles being assigned and confirms every one belongs to this
// company and isn't the Everyone role (which every user holds implicitly
// and can never be assigned or removed). Rank checks are left to the caller
// since inviting and editing use different rules.
export async function loadRolesForAssignment(
  db: Prisma.TransactionClient,
  companyId: string,
  roleIds: string[]
): Promise<
  | { roles: { id: string; name: string; rank: number; isGlobalAdmin: boolean }[]; error?: undefined }
  | { error: string; roles?: undefined }
> {
  if (roleIds.length === 0) return { roles: [] }
  const roles = await db.role.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, name: true, rank: true, isGlobalAdmin: true, isEveryone: true, companyId: true },
  })
  if (roles.length !== roleIds.length || roles.some((r) => r.companyId !== companyId)) {
    return { error: "Invalid role" }
  }
  if (roles.some((r) => r.isEveryone)) {
    return { error: "The Everyone role is held by every user automatically and can't be assigned" }
  }
  return { roles: roles.map(({ id, name, rank, isGlobalAdmin }) => ({ id, name, rank, isGlobalAdmin })) }
}

// Replaces a user's full set of assigned roles with roleIds, then keeps the
// legacy User.roleId column in sync. Callers are responsible for validating
// the roles first (same company, rank rules, never the Everyone role).
export async function setUserRoles(db: Prisma.TransactionClient, userId: string, roleIds: string[]) {
  const unique = [...new Set(roleIds)]
  await db.userRole.deleteMany({ where: { userId, roleId: { notIn: unique } } })
  if (unique.length > 0) {
    await db.userRole.createMany({
      data: unique.map((roleId) => ({ userId, roleId })),
      skipDuplicates: true,
    })
  }
  await syncLegacyRoleId(db, [userId])
}

// Legacy User.roleId is kept for one release so a rollback to the previous
// single role code still works. It always mirrors the user's highest ranked
// assigned role (never Everyone), or null when they only have Everyone.
// Nothing reads it for permission checks anymore.
export async function syncLegacyRoleId(db: Prisma.TransactionClient, userIds: string[]) {
  for (const userId of userIds) {
    const highest = await db.userRole.findFirst({
      where: { userId, role: { isEveryone: false } },
      orderBy: [{ role: { rank: "desc" } }, { createdAt: "asc" }],
      select: { roleId: true },
    })
    await db.user.update({ where: { id: userId }, data: { roleId: highest?.roleId ?? null } })
  }
}
