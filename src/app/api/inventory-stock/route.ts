import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"

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
