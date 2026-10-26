import type { Prisma, PrismaClient } from "@/generated/prisma"
import type { AccessContext } from "@/lib/api-access"
import { canSeeCostWith } from "@/lib/access-check"
import { purchaseOrderListWhere, quoteListWhere, salesOrderListWhere } from "@/lib/scoped-loaders"

// The quotes, sales orders, and purchase orders linked to one opportunity,
// for its Related panel. Each list holds only the records the user may open
// under that record's own rules (VQ, VSO, VPO, the same list filters the
// quote, sales order, and purchase order lists use), so a user without the
// page sees none of them. Never any line cost: a purchase order's total is
// worked out from cost, so it is left out unless the user may see cost.
// The caller has already run the opportunity view check (VOP).

type RelatedViewer = Pick<AccessContext, "companyId" | "userId" | "access" | "can">

// The shared client, or a stand in with the same three models
type RelatedDb = Pick<PrismaClient, "quote" | "salesOrder" | "purchaseOrder">

const quoteSelect = {
  id: true,
  quoteNumber: true,
  version: true,
  title: true,
  status: true,
  lineItems: { select: { unitPrice: true, quantity: true, discount: true } },
} satisfies Prisma.QuoteSelect

const salesOrderSelect = {
  id: true,
  soNumber: true,
  status: true,
  client: { select: { name: true } },
  lineItems: { select: { unitPrice: true, quantity: true, discount: true, isTextBlock: true } },
} satisfies Prisma.SalesOrderSelect

const purchaseOrderSelect = {
  id: true,
  poNumber: true,
  status: true,
  vendor: { select: { name: true } },
  lineItems: { select: { unitCost: true, quantity: true } },
} satisfies Prisma.PurchaseOrderSelect

export interface RelatedRecord {
  id: string
  number: string
  name: string | null
  status: string
  // Left out of a purchase order for users who can't see cost
  total?: number
}

export interface OpportunityRelated {
  quotes: RelatedRecord[]
  salesOrders: RelatedRecord[]
  purchaseOrders: RelatedRecord[]
}

const priceTotal = (lines: { unitPrice: number; quantity: number; discount: number }[]) =>
  lines.reduce((sum, li) => sum + li.unitPrice * li.quantity * (1 - li.discount / 100), 0)

export async function loadOpportunityRelated(db: RelatedDb, ctx: RelatedViewer, opportunityId: string): Promise<OpportunityRelated> {
  const [quotes, salesOrders, purchaseOrders] = await Promise.all([
    ctx.can("pages.quotes")
      ? db.quote.findMany({
          where: { AND: [quoteListWhere(ctx), { opportunityId }] },
          select: quoteSelect,
          orderBy: [{ quoteNumber: "asc" }, { version: "desc" }],
        })
      : [],
    ctx.can("pages.salesOrders")
      ? db.salesOrder.findMany({ where: { AND: [salesOrderListWhere(ctx), { opportunityId }] }, select: salesOrderSelect, orderBy: { createdAt: "asc" } })
      : [],
    ctx.can("pages.purchaseOrders")
      ? db.purchaseOrder.findMany({ where: { AND: [purchaseOrderListWhere(ctx), { opportunityId }] }, select: purchaseOrderSelect, orderBy: { createdAt: "asc" } })
      : [],
  ])

  const showCost = canSeeCostWith(ctx.can)
  return {
    // The same total the quotes list shows
    quotes: quotes.map((q) => ({
      id: q.id,
      number: q.version > 1 ? `${q.quoteNumber} v${q.version}` : q.quoteNumber,
      name: q.title,
      status: q.status,
      total: priceTotal(q.lineItems),
    })),
    // The same total the sales orders list shows
    salesOrders: salesOrders.map((so) => ({
      id: so.id,
      number: so.soNumber,
      name: so.client.name,
      status: so.status,
      total: priceTotal(so.lineItems.filter((li) => !li.isTextBlock)),
    })),
    purchaseOrders: purchaseOrders.map((po) => ({
      id: po.id,
      number: po.poNumber,
      name: po.vendor.name,
      status: po.status,
      ...(showCost ? { total: po.lineItems.reduce((sum, li) => sum + li.unitCost * li.quantity, 0) } : {}),
    })),
  }
}
