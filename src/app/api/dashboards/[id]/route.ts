import { NextRequest, NextResponse } from "next/server"
import { requireAccess, type AccessContext } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

// Personal dashboards are only editable by their owner. The Default
// dashboard is editable by anyone with dashboards.manage.
function canEdit(dashboard: { userId: string | null }, ctx: AccessContext): boolean {
  if (dashboard.userId) return dashboard.userId === ctx.userId
  return ctx.can("dashboards.manage")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const dashboard = await prisma.dashboard.findUnique({
    where: { id, companyId: ctx.companyId },
    include: { widgets: { orderBy: [{ row: "asc" }, { col: "asc" }] } },
  })
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  // A personal dashboard is only visible to its own owner, not other users.
  if (dashboard.userId && dashboard.userId !== ctx.userId) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }

  return NextResponse.json({ ...dashboard, canEdit: canEdit(dashboard, ctx) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const dashboard = await prisma.dashboard.findUnique({ where: { id, companyId: ctx.companyId } })
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  if (!canEdit(dashboard, ctx)) {
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
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const dashboard = await prisma.dashboard.findUnique({ where: { id, companyId: ctx.companyId } })
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  if (dashboard.isDefault) {
    return NextResponse.json({ error: "The Default dashboard can't be deleted" }, { status: 400 })
  }
  if (dashboard.userId !== ctx.userId) {
    return NextResponse.json({ error: "You don't have permission to delete this dashboard" }, { status: 403 })
  }

  await prisma.dashboard.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
