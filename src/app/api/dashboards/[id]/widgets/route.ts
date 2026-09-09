import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { canViewWidgetType, type WidgetType, type WidgetSize } from "@/lib/dashboards/widgetTypes"
import { findFirstAvailableCell } from "@/lib/dashboards/gridPlacement"

const VALID_TYPES: WidgetType[] = ["INVENTORY_BY_STATUS", "INVENTORY_BY_CLIENT", "OPEN_QUOTES", "OPEN_POS", "TOTAL_CLIENTS"]
const VALID_SIZES = ["SMALL", "MEDIUM", "LARGE"]

export async function POST(
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
  const canEdit = dashboard.userId ? dashboard.userId === session.user.id : await hasPermission(session.user.id, "dashboards.manage")
  if (!canEdit) {
    return NextResponse.json({ error: "You don't have permission to edit this dashboard" }, { status: 403 })
  }

  const body = await req.json()
  const widgetType: WidgetType = body.widgetType
  const size: WidgetSize = VALID_SIZES.includes(body.size) ? body.size : "MEDIUM"

  if (!VALID_TYPES.includes(widgetType)) {
    return NextResponse.json({ error: "Invalid widget type" }, { status: 400 })
  }

  const pagePermissions = (session.user.role?.permissions as { pages?: Record<string, boolean> } | undefined)?.pages ?? {}
  if (!canViewWidgetType(pagePermissions, widgetType)) {
    return NextResponse.json({ error: "You don't have permission to view that widget's data" }, { status: 403 })
  }

  const existing = await prisma.dashboardWidget.findMany({ where: { dashboardId: id }, select: { row: true, col: true, size: true } })
  const cell = findFirstAvailableCell(size, existing)
  if (!cell) {
    return NextResponse.json({ error: "This dashboard's grid is full — remove a widget or pick a smaller size" }, { status: 400 })
  }

  const widget = await prisma.dashboardWidget.create({
    data: { dashboardId: id, widgetType, size, row: cell.row, col: cell.col },
  })

  return NextResponse.json(widget)
}
