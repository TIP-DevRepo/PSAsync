import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { canPlace } from "@/lib/dashboards/gridPlacement"

async function loadDashboardAndCheckEdit(dashboardId: string, companyId: string, userId: string) {
  const dashboard = await prisma.dashboard.findUnique({ where: { id: dashboardId, companyId } })
  if (!dashboard) return { error: NextResponse.json({ error: "Dashboard not found" }, { status: 404 }) }
  const canEdit = dashboard.userId ? dashboard.userId === userId : await hasPermission(userId, "dashboards.manage")
  if (!canEdit) return { error: NextResponse.json({ error: "You don't have permission to edit this dashboard" }, { status: 403 }) }
  return { dashboard }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; widgetId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id, widgetId } = await params
  const { error } = await loadDashboardAndCheckEdit(id, session.user.companyId, session.user.id)
  if (error) return error

  const widget = await prisma.dashboardWidget.findUnique({ where: { id: widgetId } })
  if (!widget || widget.dashboardId !== id) {
    return NextResponse.json({ error: "Widget not found" }, { status: 404 })
  }

  const body = await req.json()
  if (body.row === undefined || body.col === undefined) {
    return NextResponse.json({ error: "row and col are required" }, { status: 400 })
  }
  const row = Number(body.row)
  const col = Number(body.col)
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return NextResponse.json({ error: "row and col must be whole numbers" }, { status: 400 })
  }

  const others = await prisma.dashboardWidget.findMany({
    where: { dashboardId: id, id: { not: widgetId } },
    select: { row: true, col: true, size: true },
  })
  if (!canPlace(row, col, widget.size, others)) {
    return NextResponse.json({ error: "That spot doesn't fit — it's off the grid or overlaps another widget" }, { status: 400 })
  }

  const updated = await prisma.dashboardWidget.update({ where: { id: widgetId }, data: { row, col } })
  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; widgetId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id, widgetId } = await params
  const { error } = await loadDashboardAndCheckEdit(id, session.user.companyId, session.user.id)
  if (error) return error

  const widget = await prisma.dashboardWidget.findUnique({ where: { id: widgetId } })
  if (!widget || widget.dashboardId !== id) {
    return NextResponse.json({ error: "Widget not found" }, { status: 404 })
  }

  await prisma.dashboardWidget.delete({ where: { id: widgetId } })
  return NextResponse.json({ deleted: true })
}
