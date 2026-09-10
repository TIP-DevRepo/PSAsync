import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

// Personal dashboards are only editable by their owner. The Default
// dashboard is editable by anyone with dashboards.manage.
async function canEdit(dashboard: { userId: string | null }, userId: string): Promise<boolean> {
  if (dashboard.userId) return dashboard.userId === userId
  return hasPermission(userId, "dashboards.manage")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const dashboard = await prisma.dashboard.findUnique({
    where: { id, companyId: session.user.companyId },
    include: { widgets: { orderBy: [{ row: "asc" }, { col: "asc" }] } },
  })
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  // A personal dashboard is only visible to its own owner, not other users.
  if (dashboard.userId && dashboard.userId !== session.user.id) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }

  return NextResponse.json({ ...dashboard, canEdit: await canEdit(dashboard, session.user.id) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const dashboard = await prisma.dashboard.findUnique({ where: { id, companyId: session.user.companyId } })
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  if (!(await canEdit(dashboard, session.user.id))) {
    return NextResponse.json({ error: "You don't have permission to edit this dashboard" }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: "Name can't be blank" }, { status: 400 })
    data.name = name
  }

  const updated = await prisma.dashboard.update({ where: { id }, data })
  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const dashboard = await prisma.dashboard.findUnique({ where: { id, companyId: session.user.companyId } })
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  if (dashboard.isDefault) {
    return NextResponse.json({ error: "The Default dashboard can't be deleted" }, { status: 400 })
  }
  if (dashboard.userId !== session.user.id) {
    return NextResponse.json({ error: "You don't have permission to delete this dashboard" }, { status: 403 })
  }

  await prisma.dashboard.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
