import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Marks a dashboard as the one that loads for this user at /dashboard —
// their own personal dashboard, or explicitly picking the shared company
// Default back after having switched to something else. Purely a
// per-user preference, doesn't touch Dashboard.isDefault (the one
// shared, company wide fallback everyone starts with).
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
  // Same visibility rule as everywhere else — a personal dashboard can
  // only ever be seen (and so only ever set as default) by its owner.
  if (dashboard.userId && dashboard.userId !== session.user.id) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { defaultDashboardId: id } })
  return NextResponse.json({ defaultDashboardId: id })
}
