import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

// Copies a dashboard (typically the read-only company Default) into a
// brand new personal dashboard owned by the requesting user, widgets
// included, so they can edit it freely from there.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const source = await prisma.dashboard.findUnique({
    where: { id, companyId: ctx.companyId },
    include: { widgets: true },
  })
  if (!source) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  if (source.userId && source.userId !== ctx.userId) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }

  const clone = await prisma.dashboard.create({
    data: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      name: `${source.name} (My Copy)`,
      isDefault: false,
      widgets: {
        create: source.widgets.map((w) => ({
          widgetType: w.widgetType,
          size: w.size,
          row: w.row,
          col: w.col,
        })),
      },
    },
    include: { widgets: { orderBy: [{ row: "asc" }, { col: "asc" }] } },
  })

  return NextResponse.json(clone)
}
