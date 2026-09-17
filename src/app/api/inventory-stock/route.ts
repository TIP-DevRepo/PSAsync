import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"
import { hasPermission } from "@/lib/permissions"

// Flat, company-wide list of every InventoryStock (pooled, non-serialized
// quantity) row for the Inventory list page's Stock tab.
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId

  const stocks = await prisma.inventoryStock.findMany({
    where: { companyId },
    select: {
      id: true,
      quantity: true,
      catalogItemId: true,
      catalogItem: { select: { name: true } },
      locationId: true,
    },
    orderBy: { catalogItem: { name: "asc" } },
  })

  const locations = await prisma.inventoryLocation.findMany({
    where: { companyId },
    select: { id: true, name: true, parentId: true },
  })
  const pathById = new Map(buildLocationPathOptions(locations).map((p) => [p.id, p.label]))

  const result = stocks.map((s) => ({
    ...s,
    containerPath: pathById.get(s.locationId) ?? null,
  }))

  return NextResponse.json(result)
}

// Manually add (or top up) pooled stock for a non-serialized Catalog Item
// at a specific container, outside of PO receiving. InventoryStock has no
// owner/client field of its own — ownership is implicit in which
// container it's placed in — so only the container needs validating here.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "pages.inventory"))) {
    return NextResponse.json({ error: "You don't have access to Inventory" }, { status: 403 })
  }

  const companyId = session.user.companyId
  const body = await req.json()
  const { catalogItemId, clientLocationId, locationId } = body
  const quantity = Math.round(Number(body.quantity))

  if (!catalogItemId) {
    return NextResponse.json({ error: "Catalog Item is required" }, { status: 400 })
  }
  const catalogItem = await prisma.catalogItem.findUnique({ where: { id: catalogItemId, companyId } })
  if (!catalogItem) {
    return NextResponse.json({ error: "Catalog Item not found" }, { status: 404 })
  }
  if (catalogItem.isSerialized) {
    return NextResponse.json({ error: "This Catalog Item is serialized, add it as a Serialized Asset instead" }, { status: 400 })
  }

  if (!clientLocationId) {
    return NextResponse.json({ error: "Select a location" }, { status: 400 })
  }
  if (!locationId) {
    return NextResponse.json({ error: "Select a container" }, { status: 400 })
  }
  const container = await prisma.inventoryLocation.findUnique({ where: { id: locationId, companyId, clientLocationId } })
  if (!container) {
    return NextResponse.json({ error: "Container not found" }, { status: 404 })
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "Enter a valid quantity" }, { status: 400 })
  }

  const stock = await prisma.inventoryStock.upsert({
    where: { catalogItemId_locationId: { catalogItemId, locationId } },
    create: { companyId, catalogItemId, locationId, quantity },
    update: { quantity: { increment: quantity } },
  })

  await prisma.inventoryStockEvent.create({
    data: {
      stockId: stock.id,
      eventType: "RECEIVED",
      quantityChange: quantity,
      description: "Manually added to inventory",
      performedByUserId: session.user.id,
    },
  })

  return NextResponse.json(stock)
}
