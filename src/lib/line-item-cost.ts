import { prisma } from "@/lib/prisma"
import { canSeeCost, type AccessContext } from "@/lib/api-access"
import { catalogItemWhere } from "@/lib/scoped-loaders"

// The cost rule for quote, quote template, sales order, and purchase order
// line items. Cost is the company's dealer pricing, so a caller who can't
// see it (canSeeCost) can't set it from the browser either.

type CostCaller = Pick<AccessContext, "companyId" | "can">

// A cost the request sent as a finite number, or null when it sent none
function readRequestCost(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Cost for a new line item:
// - a caller who can see cost gets the cost they sent when it's a finite
//   number, otherwise the catalog item's stored cost (0 with no catalog item)
// - a caller who can't see cost always gets the catalog item's stored cost,
//   company scoped, or 0 with no catalog item. The request's cost is ignored.
export async function newLineItemCost(ctx: CostCaller, catalogItemId: unknown, requestedCost: unknown): Promise<number> {
  if (canSeeCost(ctx)) {
    const sent = readRequestCost(requestedCost)
    if (sent !== null) return sent
  }
  if (typeof catalogItemId !== "string" || !catalogItemId) return 0
  const item = await prisma.catalogItem.findFirst({
    where: catalogItemWhere(ctx, catalogItemId),
    select: { cost: true },
  })
  return item?.cost ?? 0
}

// Whether a PATCH may write the cost it sent. A caller who can't see cost
// never changes it, and the stored value is kept.
export function mayWriteCost(ctx: CostCaller, requestedCost: unknown): boolean {
  return requestedCost !== undefined && canSeeCost(ctx)
}
