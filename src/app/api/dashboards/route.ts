import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

// Every company always has exactly one shared Default dashboard. It's
// created lazily on first access rather than at company signup, since
// there's no single company-creation hook this can hang off of.
async function ensureDefaultDashboard(companyId: string) {
  const existing = await prisma.dashboard.findFirst({ where: { companyId, isDefault: true } })
  if (existing) return existing
  return prisma.dashboard.create({
    data: { companyId, name: "Default", isDefault: true, userId: null },
  })
}

export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const companyId = ctx.companyId
  await ensureDefaultDashboard(companyId)

  const [dashboards, user] = await Promise.all([
    prisma.dashboard.findMany({
      where: {
        companyId,
        OR: [{ isDefault: true }, { userId: ctx.userId }],
      },
      select: { id: true, name: true, isDefault: true, userId: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { defaultDashboardId: true } }),
  ])

  const withMyDefault = dashboards.map((d) => ({ ...d, isMyDefault: d.id === user?.defaultDashboardId }))
  return NextResponse.json(withMyDefault)
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const body = await req.json()
  const name = (body.name ?? "").trim()
  if (!name) {
    return NextResponse.json({ error: "A dashboard name is required" }, { status: 400 })
  }

  const dashboard = await prisma.dashboard.create({
    data: { companyId: ctx.companyId, userId: ctx.userId, name, isDefault: false },
  })

  return NextResponse.json(dashboard)
}
