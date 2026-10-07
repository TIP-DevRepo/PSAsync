import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission, getUserRank } from "@/lib/permissions"
import { getRegularRolesInOrder, applyRegularRoleOrder } from "@/lib/role-order"

// Saves a new rank order from the drag to reorder list in Roles &
// Permissions. The body is every regular role id (not Global Admin or
// Everyone, which stay pinned top and bottom), highest first, exactly as
// the list shows it. Ranks are renumbered N down to 1 in one transaction.
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to reorder roles" }, { status: 403 })
  }

  const companyId = session.user.companyId
  const body = await req.json().catch(() => ({}))
  const roleIds: unknown = body.roleIds
  if (!Array.isArray(roleIds) || !roleIds.every((r) => typeof r === "string") || new Set(roleIds).size !== roleIds.length) {
    return NextResponse.json({ error: "Invalid role order" }, { status: 400 })
  }

  const pinned = await prisma.role.count({
    where: { companyId, id: { in: roleIds as string[] }, OR: [{ isGlobalAdmin: true }, { isEveryone: true }] },
  })
  if (pinned > 0) {
    return NextResponse.json(
      { error: "Global Admin and Everyone are pinned to the top and bottom and can't be moved" },
      { status: 403 }
    )
  }

  const actorRank = await getUserRank(session.user.id)

  const result = await prisma.$transaction(async (tx) => {
    const current = await getRegularRolesInOrder(tx, companyId)

    // The submitted list must be exactly this company's regular roles, so a
    // stale list from before another admin added or deleted a role can't
    // silently drop or reshuffle anything
    const currentIds = new Set(current.map((r) => r.id))
    if (roleIds.length !== current.length || !(roleIds as string[]).every((id) => currentIds.has(id))) {
      return { error: "The role list changed since you loaded it. Refresh and try again.", status: 409 }
    }

    // You can only move roles strictly below your own highest rank, and only
    // drop them below it. Roles at or above your rank always sit at the top
    // of the list, so they must stay exactly where they are, in the same
    // order, and everything you can move has to stay underneath them.
    const locked = current.filter((r) => r.rank >= actorRank)
    const lockedUnchanged = locked.every((r, i) => roleIds[i] === r.id)
    if (!lockedUnchanged) {
      return { error: "You can only move roles below your own rank, and only to positions below it", status: 403 }
    }

    const currentRanks = new Map(current.map((r) => [r.id, r.rank]))
    await applyRegularRoleOrder(tx, companyId, roleIds as string[], currentRanks)
    return { ok: true as const }
  }, { timeout: 15000 })

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
