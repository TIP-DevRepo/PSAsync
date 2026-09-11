import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Copies a dashboard (typically the read-only company Default) into a
// brand new personal dashboard owned by the requesting user, widgets
// included, so they can edit it freely from there.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const source = await prisma.dashboard.findUnique({
    where: { id, companyId: session.user.companyId },
    include: { widgets: true },
  })
  if (!source) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }
  if (source.userId && source.userId !== session.user.id) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }

  const clone = await prisma.dashboard.create({
    data: {
      companyId: session.user.companyId,
      userId: session.user.id,
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
