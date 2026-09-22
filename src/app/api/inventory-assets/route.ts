import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { buildLocationPathOptions } from "@/lib/inventory/locationPaths"
import { generateAssetTag } from "@/lib/inventory/generateAssetTag"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"
import { hasPermission } from "@/lib/permissions"
import type { InventoryRemovedReason } from "@/generated/prisma"

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

const VALID_REMOVED_REASONS = ["BROKEN_SCRAPPED", "LOST", "DONATED", "RETURNED_TO_VENDOR", "OTHER"] as const

// Manually add a single serialized InventoryAsset, outside of PO receiving.
// Field-for-field, this mirrors what the /checkout route already does to an
// EXISTING asset for each status, so a manually-added asset never starts
// out missing data a PO-received-then-checked-out one would have:
//   SOLD     -> ownerType CLIENT/ownerClientId, optional deployedToContactId
//   LOANED   -> ownerType/ownerClientId untouched; loanedToClientId/
//               loanedToContactId/loanExpectedReturnDate instead
//   INTERNAL -> ownerType/ownerClientId untouched; assignedUserId instead,
//               no location tracking at all
//   REMOVED  -> same Owner/Location flow as IN_STOCK, plus removedReason
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
  const { catalogItemId, status } = body
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

  if (!serialNumber) {
    return NextResponse.json({ error: "Serial number is required" }, { status: 400 })
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Select a valid status" }, { status: 400 })
  }

  // Fields resolved below, per status, then applied in one create() call.
  let tagClientId: string | undefined
  let ownerType: "COMPANY" | "CLIENT" = "COMPANY"
  let ownerClientId: string | null = null
  let clientLocationId: string | null = null
  let locationId: string | null = null
  let deployedToContactId: string | null = null
  let loanedToClientId: string | null = null
  let loanedToContactId: string | null = null
  let loanExpectedReturnDate: Date | null = null
  let assignedUserId: string | null = null
  let removedReason: InventoryRemovedReason | null = null

  if (status === "LOANED") {
    if (!body.loanedToClientId) {
      return NextResponse.json({ error: "A client to loan to is required" }, { status: 400 })
    }
    const loanClient = await prisma.client.findUnique({ where: { id: body.loanedToClientId, companyId } })
    if (!loanClient) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }
    if (!body.loanedToContactId) {
      return NextResponse.json({ error: "A contact is required" }, { status: 400 })
    }
    const contact = await prisma.contact.findUnique({ where: { id: body.loanedToContactId, clientId: loanClient.id } })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })
    }
    if (!body.loanExpectedReturnDate) {
      return NextResponse.json({ error: "Expected return date is required" }, { status: 400 })
    }
    const resolvedSite = body.clientLocationId ?? contact.locationId ?? null
    if (!resolvedSite) {
      return NextResponse.json({ error: "Select which of the client's sites this is loaned to" }, { status: 400 })
    }

    loanedToClientId = loanClient.id
    loanedToContactId = contact.id
    loanExpectedReturnDate = new Date(body.loanExpectedReturnDate)
    clientLocationId = resolvedSite
    locationId = null
  } else if (status === "INTERNAL") {
    if (!body.assignedUserId) {
      return NextResponse.json({ error: "A user is required" }, { status: 400 })
    }
    const user = await prisma.user.findUnique({ where: { id: body.assignedUserId, companyId } })
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    assignedUserId = user.id
    locationId = null
    clientLocationId = null
  } else {
    // IN_STOCK / PENDING_OFFBOARD / SOLD / REMOVED all go through the same
    // Owner + Location/Container flow.
    if (!body.clientId) {
      return NextResponse.json({ error: "Client is required" }, { status: 400 })
    }
    const client = await prisma.client.findUnique({ where: { id: body.clientId, companyId } })
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }
    tagClientId = client.id
    ownerType = client.isInternal ? "COMPANY" : "CLIENT"
    ownerClientId = ownerType === "CLIENT" ? client.id : null

    if (status === "SOLD" && body.deployedToContactId) {
      const contact = await prisma.contact.findUnique({ where: { id: body.deployedToContactId, clientId: client.id } })
      if (!contact) {
        return NextResponse.json({ error: "Contact not found for this client" }, { status: 404 })
      }
      deployedToContactId = contact.id
      const resolvedSite = body.clientLocationId ?? contact.locationId ?? null
      if (!resolvedSite) {
        return NextResponse.json({ error: "Select which of the client's sites this is deployed at" }, { status: 400 })
      }
      clientLocationId = resolvedSite
      locationId = null
    } else {
      if (!body.clientLocationId) {
        return NextResponse.json({ error: "Select a location" }, { status: 400 })
      }
      const site = await prisma.clientLocation.findFirst({ where: { id: body.clientLocationId, clientId: client.id } })
      if (!site) {
        return NextResponse.json({ error: "Location not found" }, { status: 404 })
      }
      clientLocationId = ownerType === "CLIENT" ? body.clientLocationId : null

      // Container is only mandatory once this client is actually onboarded
      // for Inventory AND the chosen site has containers built under it —
      // otherwise there's nothing sensible to require, and the asset just
      // tracks at the site level, mirroring PO receiving's own
      // client-owned-but-no-container fallback.
      if (body.locationId) {
        const container = await prisma.inventoryLocation.findUnique({ where: { id: body.locationId, companyId, clientLocationId: body.clientLocationId } })
        if (!container) {
          return NextResponse.json({ error: "Container not found" }, { status: 404 })
        }
        locationId = body.locationId
      } else {
        const containerCount = await prisma.inventoryLocation.count({ where: { clientLocationId: body.clientLocationId, companyId } })
        if (client.inventoryOnboarded && containerCount > 0) {
          return NextResponse.json({ error: "Select a container" }, { status: 400 })
        }
        locationId = null
      }
    }

    if (status === "REMOVED") {
      if (!VALID_REMOVED_REASONS.includes(body.removedReason)) {
        return NextResponse.json({ error: "Select a valid removed reason" }, { status: 400 })
      }
      removedReason = body.removedReason as InventoryRemovedReason
    }
  }

  if (body.overrideVendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: body.overrideVendorId, companyId } })
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }
  }
  if (body.overrideManufacturerId) {
    const manufacturer = await prisma.vendor.findUnique({ where: { id: body.overrideManufacturerId, companyId } })
    if (!manufacturer) {
      return NextResponse.json({ error: "Manufacturer not found" }, { status: 404 })
    }
  }

  const customFieldValues: { customFieldId: string; value: string }[] = Array.isArray(body.customFieldValues)
    ? body.customFieldValues.filter((v: { customFieldId?: string; value?: string }) => v?.customFieldId && v.value?.trim())
    : []

  try {
    const assetTag = await generateAssetTag(companyId, tagClientId)

    const asset = await prisma.inventoryAsset.create({
      data: {
        companyId,
        catalogItemId,
        assetTag,
        serialNumber,
        status,
        ownerType,
        ownerClientId,
        clientLocationId,
        locationId,
        deployedToContactId,
        loanedToClientId,
        loanedToContactId,
        loanExpectedReturnDate,
        assignedUserId,
        removedReason,
        warrantyType: body.warrantyType?.trim() || null,
        warrantyExpiration: body.warrantyExpiration ? new Date(body.warrantyExpiration) : null,
        overrideVendorId: body.overrideVendorId || null,
        overrideVendorSku: body.overrideVendorSku?.trim() || null,
        overrideManufacturerId: body.overrideManufacturerId || null,
        overrideManufacturerSku: body.overrideManufacturerSku?.trim() || null,
        notes: body.notes?.trim() || null,
        customFieldValues: customFieldValues.length > 0 ? { create: customFieldValues } : undefined,
      },
    })

    await logAssetEvent(asset.id, "CREATED", "Manually added to inventory", session.user.id)

    return NextResponse.json(asset)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't add this asset"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
