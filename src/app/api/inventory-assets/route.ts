import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"
import { generateAssetTag } from "@/lib/inventory/generateAssetTag"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"
import { hasPermission } from "@/lib/permissions"

const VALID_STATUSES = ["IN_STOCK", "INTERNAL", "LOANED", "SOLD", "PENDING_OFFBOARD", "REMOVED"] as const

// Flat, company-wide list of every InventoryAsset for the Inventory list
// page's Assets tab. Filtering/sorting all happens client-side against
// this array, matching every other list page in the app.
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId

  const assets = await prisma.inventoryAsset.findMany({
    where: { companyId },
    select: {
      id: true,
      assetTag: true,
      status: true,
      ownerType: true,
      ownerClientId: true,
      ownerClient: { select: { name: true } },
      loanedToClientId: true,
      deployedToContactId: true,
      locationId: true,
      clientLocation: { select: { name: true } },
      catalogItem: {
        select: { name: true, categoryRef: { select: { name: true, parent: { select: { name: true } } } } },
      },
      deployedToContact: { select: { firstName: true, lastName: true } },
      loanedToContact: { select: { firstName: true, lastName: true } },
      assignedUser: { select: { name: true } },
    },
    orderBy: { assetTag: "asc" },
  })

  const locations = await prisma.inventoryLocation.findMany({
    where: { companyId },
    select: { id: true, name: true, parentId: true },
  })
  const pathById = new Map(buildLocationPathOptions(locations).map((p) => [p.id, p.label]))

  const result = assets.map((a) => ({
    ...a,
    containerPath: a.locationId ? pathById.get(a.locationId) ?? null : null,
  }))

  return NextResponse.json(result)
}

// Manually add a single serialized InventoryAsset, outside of PO receiving.
// Mirrors the validation/creation the PO receive route already does for
// serialized line items, but takes the ownership client and starting
// status directly from the caller instead of inferring them from a PO.
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
  const { catalogItemId, clientId, clientLocationId, locationId, status } = body
  const serialNumber = typeof body.serialNumber === "string" ? body.serialNumber.trim() : ""

  if (!catalogItemId) {
    return NextResponse.json({ error: "Catalog Item is required" }, { status: 400 })
  }
  const catalogItem = await prisma.catalogItem.findUnique({ where: { id: catalogItemId, companyId } })
  if (!catalogItem) {
    return NextResponse.json({ error: "Catalog Item not found" }, { status: 404 })
  }
  if (!catalogItem.isSerialized) {
    return NextResponse.json({ error: "This Catalog Item isn't serialized, add it as Pooled Stock instead" }, { status: 400 })
  }

  if (!clientId) {
    return NextResponse.json({ error: "Client is required" }, { status: 400 })
  }
  const client = await prisma.client.findUnique({ where: { id: clientId, companyId } })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  if (!clientLocationId) {
    return NextResponse.json({ error: "Select a location" }, { status: 400 })
  }
  const site = await prisma.clientLocation.findFirst({ where: { id: clientLocationId, clientId } })
  if (!site) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 })
  }

  // Container is only mandatory once this client is actually onboarded for
  // Inventory AND the chosen site has containers built under it — otherwise
  // there's nothing sensible to require, and the asset just tracks at the
  // site level (locationId stays null), mirroring PO receiving's own
  // client-owned-but-no-container fallback.
  if (locationId) {
    const container = await prisma.inventoryLocation.findUnique({ where: { id: locationId, companyId, clientLocationId } })
    if (!container) {
      return NextResponse.json({ error: "Container not found" }, { status: 404 })
    }
  } else {
    const containerCount = await prisma.inventoryLocation.count({ where: { clientLocationId, companyId } })
    if (client.inventoryOnboarded && containerCount > 0) {
      return NextResponse.json({ error: "Select a container" }, { status: 400 })
    }
  }

  if (!serialNumber) {
    return NextResponse.json({ error: "Serial number is required" }, { status: 400 })
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Select a valid status" }, { status: 400 })
  }

  const ownerType = client.isInternal ? "COMPANY" : "CLIENT"

  try {
    const assetTag = await generateAssetTag(companyId, clientId)

    const asset = await prisma.inventoryAsset.create({
      data: {
        companyId,
        catalogItemId,
        assetTag,
        serialNumber,
        status,
        ownerType,
        ownerClientId: ownerType === "CLIENT" ? clientId : null,
        clientLocationId: ownerType === "CLIENT" ? clientLocationId : null,
        locationId: locationId || null,
      },
    })

    await logAssetEvent(asset.id, "CREATED", "Manually added to inventory", session.user.id)

    return NextResponse.json(asset)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't add this asset"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
