import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import type { QuoteStatus, POStatus } from "@/generated/prisma"
import { computeStatusLabel } from "@/lib/inventory/statusLabel"
import { canViewWidgetType, type WidgetType } from "@/lib/dashboards/widgetTypes"

function monthBounds(offsetMonths: number) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths + 1, 1))
  return { start, end }
}

// Percent change from last month to this month, using a "went from
// nothing to something" convention (100%) when the prior month was zero,
// rather than a divide-by-zero.
function trendDelta(thisMonth: number, lastMonth: number): number {
  if (lastMonth === 0) return thisMonth === 0 ? 0 : 100
  return Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
}

async function countTrend(model: { count: (args: { where: Record<string, unknown> }) => Promise<number> }, baseWhere: Record<string, unknown>) {
  const thisMonthRange = monthBounds(0)
  const lastMonthRange = monthBounds(-1)
  const [thisMonth, lastMonth] = await Promise.all([
    model.count({ where: { ...baseWhere, createdAt: { gte: thisMonthRange.start, lt: thisMonthRange.end } } }),
    model.count({ where: { ...baseWhere, createdAt: { gte: lastMonthRange.start, lt: lastMonthRange.end } } }),
  ])
  return { thisMonth, lastMonth, deltaPct: trendDelta(thisMonth, lastMonth) }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const type = req.nextUrl.searchParams.get("type") as WidgetType | null
  if (!type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 })
  }

  const pagePermissions = (session.user.role?.permissions as { pages?: Record<string, boolean> } | undefined)?.pages ?? {}
  if (!canViewWidgetType(pagePermissions, type)) {
    return NextResponse.json({ error: "You don't have permission to view this widget's data" }, { status: 403 })
  }

  const companyId = session.user.companyId

  if (type === "INVENTORY_BY_STATUS") {
    const assets = await prisma.inventoryAsset.findMany({
      where: { companyId },
      select: { status: true, ownerClientId: true, loanedToClientId: true, deployedToContactId: true },
    })
    const counts = new Map<string, number>()
    for (const a of assets) {
      const label = computeStatusLabel(a)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const groups = Array.from(counts.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
    return NextResponse.json({ type, groups })
  }

  if (type === "INVENTORY_BY_CLIENT") {
    const assets = await prisma.inventoryAsset.findMany({
      where: { companyId },
      select: { ownerType: true, ownerClient: { select: { name: true } } },
    })
    const counts = new Map<string, number>()
    for (const a of assets) {
      const key = a.ownerType === "COMPANY" ? "Us" : a.ownerClient?.name ?? "Unknown"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const groups = Array.from(counts.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
    return NextResponse.json({ type, groups })
  }

  if (type === "OPEN_QUOTES") {
    const openStatuses: QuoteStatus[] = ["DRAFT", "PENDING_APPROVAL", "SENT", "VIEWED"]
    const [count, trend] = await Promise.all([
      prisma.quote.count({ where: { companyId, status: { in: openStatuses } } }),
      countTrend(prisma.quote, { companyId }),
    ])
    return NextResponse.json({ type, count, ...trend })
  }

  if (type === "OPEN_POS") {
    const openStatuses: POStatus[] = ["DRAFT", "PARTS_ORDERED", "ON_HOLD", "BACKORDERED"]
    const [count, trend] = await Promise.all([
      prisma.purchaseOrder.count({ where: { companyId, status: { in: openStatuses } } }),
      countTrend(prisma.purchaseOrder, { companyId }),
    ])
    return NextResponse.json({ type, count, ...trend })
  }

  if (type === "TOTAL_CLIENTS") {
    const [count, trend] = await Promise.all([
      prisma.client.count({ where: { companyId, isInternal: false } }),
      countTrend(prisma.client, { companyId, isInternal: false }),
    ])
    return NextResponse.json({ type, count, ...trend })
  }

  return NextResponse.json({ error: "Unknown widget type" }, { status: 400 })
}
