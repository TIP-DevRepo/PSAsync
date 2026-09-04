import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"

// Flat list of every Container across every one of our own company's
// sites, e.g. "Main HQ: Rack A > Shelf 1". Used anywhere that needs to
// stock something at our own warehouse — Checkout, Offboard, and PO
// Receiving when shipping to ourselves rather than a client.
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId

  const internalClient = await prisma.client.findFirst({
    where: { companyId, isInternal: true },
    select: { locations: { select: { id: true, name: true } } },
  })
  if (!internalClient) {
    return NextResponse.json([])
  }

  const locationIds = internalClient.locations.map((l) => l.id)
  const locationNameById = new Map(internalClient.locations.map((l) => [l.id, l.name]))

  const containers = await prisma.inventoryLocation.findMany({
    where: { clientLocationId: { in: locationIds }, companyId },
    select: { id: true, name: true, parentId: true, clientLocationId: true },
  })

  // Prefix each container's path with its site name, since two different
  // sites could each have their own "Rack A".
  const grouped = locationIds.map((locId) => {
    const siteContainers = containers.filter((c) => c.clientLocationId === locId)
    const paths = buildLocationPathOptions(siteContainers)
    const siteName = locationNameById.get(locId) ?? "Site"
    return paths.map((p) => ({ id: p.id, label: `${siteName}: ${p.label}` }))
  })

  return NextResponse.json(grouped.flat().sort((a, b) => a.label.localeCompare(b.label)))
}