import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { ensureEveryoneRole } from "@/lib/everyone-role"
import { readRoleColor } from "@/lib/role-colors"
import { getRegularRolesInOrder, applyRegularRoleOrder } from "@/lib/role-order"

const DEFAULT_PERMISSIONS = {
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

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Every company always has exactly one Everyone role, created here on
  // demand if it is somehow missing so Roles & Permissions can edit it
  await ensureEveryoneRole(prisma, session.user.companyId)

  // Highest rank first, ties oldest first: the same order getRegularRolesInOrder
  // uses, so what the Roles & Permissions list shows is what a reorder saves.
  // userCount is how many users hold the role (Everyone is implicit, so 0).
  const roles = await prisma.role.findMany({
    where: { companyId: session.user.companyId },
    orderBy: [{ rank: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { userRoles: true } } },
  })

  return NextResponse.json(roles.map(({ _count, ...role }) => ({ ...role, userCount: _count.userRoles })))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to create roles" }, { status: 403 })
  }

  const companyId = session.user.companyId
  const body = await req.json()
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const color = readRoleColor(body.color)
  if (color === false) {
    return NextResponse.json({ error: "Color must be a hex value like #3B82F6" }, { status: 400 })
  }

  const existing = await prisma.role.findUnique({
    where: { companyId_name: { companyId, name: body.name.trim() } },
  })
  if (existing) {
    return NextResponse.json({ error: "A role with that name already exists" }, { status: 400 })
  }

  await ensureEveryoneRole(prisma, companyId)

  // Rank is no longer typed in. A new role always starts at the bottom of
  // the draggable list, just above Everyone, and the regular roles are
  // renumbered so it gets rank 1 with every other role keeping its order.
  const role = await prisma.$transaction(async (tx) => {
    const ordered = await getRegularRolesInOrder(tx, companyId)
    const created = await tx.role.create({
      data: {
        companyId,
        name: body.name.trim(),
        rank: 0,
        color: color ?? null,
        permissions: DEFAULT_PERMISSIONS,
        isSystem: false,
      },
    })
    const currentRanks = new Map(ordered.map((r) => [r.id, r.rank]))
    currentRanks.set(created.id, created.rank)
    await applyRegularRoleOrder(tx, companyId, [...ordered.map((r) => r.id), created.id], currentRanks)
    return tx.role.findUniqueOrThrow({ where: { id: created.id } })
  })

  return NextResponse.json(role)
}
