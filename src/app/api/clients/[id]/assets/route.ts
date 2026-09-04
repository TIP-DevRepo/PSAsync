import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

interface ContainerNode { id: string; name: string; parentId: string | null }

// Walks a container's parentId chain to build its full path, e.g.
// ["Rack A", "Shelf 1", "Slot A"].
function fullPathParts(containerId: string, byId: Map<string, ContainerNode>): string[] {
  const parts: string[] = []
  let current = byId.get(containerId)
  while (current) {
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return parts
}

// Groups only go two levels deep (e.g. "Rack A > Shelf 1"), anything
// nested further (Slot A, Slot B, etc.) collapses into that same group —
// the exact sub-container still shows up in an asset's own detail view.
function groupLabel(containerId: string, byId: Map<string, ContainerNode>): string {
  return fullPathParts(containerId, byId).slice(0, 2).join(" > ")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id: clientId } = await params
  const companyId = session.user.companyId

  const client = await prisma.client.findUnique({
    where: { id: clientId, companyId },
    select: { id: true, locations: { select: { id: true, name: true } } },
  })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // Covers both ownership paths: assets this client actually owns
  // (Sold), and assets that are still company-owned but currently out
  // on loan to this client (Loaned never transfers ownership).
  const assets = await prisma.inventoryAsset.findMany({
    where: {
      companyId,
      OR: [
        { ownerType: "CLIENT", ownerClientId: clientId },
        { loanedToClientId: clientId },
      ],
    },
    select: {
      id: true,
      assetTag: true,
      serialNumber: true,
      status: true,
      clientLocationId: true,
      locationId: true,
      deployedToContactId: true,
      loanedToContactId: true,
      catalogItem: { select: { name: true } },
    },
    orderBy: { assetTag: "asc" },
  })

  const locationIds = client.locations.map((l) => l.id)
  const allContainers = await prisma.inventoryLocation.findMany({
    where: { clientLocationId: { in: locationIds } },
    select: { id: true, name: true, parentId: true },
  })
  const containerById = new Map(allContainers.map((c) => [c.id, c]))

  const result = client.locations.map((loc) => {
    const locationAssets = assets.filter((a) => a.clientLocationId === loc.id)

    // Deployed: someone specific has it (a Contact, whether Sold or
    // Loaned). Unknown: received/returned but not yet assigned anywhere.
    // Container: has a specific stocked location.
    const deployed = locationAssets.filter((a) => a.deployedToContactId || a.loanedToContactId)
    const unknown = locationAssets.filter((a) => !a.locationId && !a.deployedToContactId && !a.loanedToContactId)

    // Group by the top two levels of the container path only, e.g. both
    // "Rack 1 > Shelf A > Slot 1" and "Rack 1 > Shelf A > Slot 2" collapse
    // into one "Rack 1 > Shelf A" group. The exact sub-container is still
    // visible in the asset's own detail panel.
    const containerGroups = new Map<string, typeof locationAssets>()
    locationAssets
      .filter((a) => a.locationId && !a.deployedToContactId && !a.loanedToContactId)
      .forEach((a) => {
        const key = groupLabel(a.locationId as string, containerById)
        const list = containerGroups.get(key) ?? []
        list.push(a)
        containerGroups.set(key, list)
      })

    const containers = Array.from(containerGroups.entries())
      .map(([label, containerAssets]) => ({
        id: label,
        path: label,
        assets: containerAssets.map((a) => ({
          id: a.id,
          assetTag: a.assetTag,
          catalogItemName: a.catalogItem.name,
        })),
      }))
      .sort((a, b) => a.path.localeCompare(b.path))

    return {
      id: loc.id,
      name: loc.name,
      deployed: deployed.map((a) => ({
        id: a.id,
        assetTag: a.assetTag,
        catalogItemName: a.catalogItem.name,
      })),
      unknown: unknown.map((a) => ({
        id: a.id,
        assetTag: a.assetTag,
        catalogItemName: a.catalogItem.name,
      })),
      containers,
    }
  })

  return NextResponse.json(result)
}