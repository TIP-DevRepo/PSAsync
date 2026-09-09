import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

const DEFAULT_PERMISSIONS = {
  pages: { clients: false, catalog: false, vendors: false, inventory: false, quotes: false, settings: false, salesOrders: false, purchaseOrders: false },
  quotes: { create: false, edit: false, delete: false, changeStatus: false, approve: false, sendEmail: false, viewAllUsersQuotes: false },
  clients: { create: false, edit: false, delete: false, viewAllClients: false },
  salesOrders: { create: false, edit: false, delete: false, changeStatus: false, generatePO: false, viewAll: false },
  purchaseOrders: { create: false, edit: false, delete: false, changeStatus: false, send: false },
  settingsSections: { company: false, users: false, quotes: false, approvalWorkflows: false, notifications: false, integrations: false, salesOrders: false },
  dashboards: { manage: false },
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const roles = await prisma.role.findMany({
    where: { companyId: session.user.companyId },
    orderBy: { rank: "desc" },
  })

  return NextResponse.json(roles)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "settingsSections.users"))) {
    return NextResponse.json({ error: "You don't have permission to create roles" }, { status: 403 })
  }

  const body = await req.json()
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const existing = await prisma.role.findUnique({
    where: { companyId_name: { companyId: session.user.companyId, name: body.name.trim() } },
  })
  if (existing) {
    return NextResponse.json({ error: "A role with that name already exists" }, { status: 400 })
  }

  const role = await prisma.role.create({
    data: {
      companyId: session.user.companyId,
      name: body.name.trim(),
      rank: Number(body.rank) || 0,
      permissions: DEFAULT_PERMISSIONS,
      isSystem: false,
    },
  })

  return NextResponse.json(role)
}