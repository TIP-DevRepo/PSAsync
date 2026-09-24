import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"

interface ContainerNode { id: string; name: string; parentId: string | null }

async function buildContainerPath(companyId: string, containerId: string): Promise<string> {
  const parts: string[] = []
  let currentId: string | null = containerId
  while (currentId) {
    const current: ContainerNode | null = await prisma.inventoryLocation.findUnique({
      where: { id: currentId, companyId },
      select: { id: true, name: true, parentId: true },
    })
    if (!current) break
    parts.unshift(current.name)
    currentId = current.parentId
  }
  return parts.join(" > ")
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId

  const asset = await prisma.inventoryAsset.findUnique({
    where: { id, companyId },
    include: {
      catalogItem: { select: { name: true, categoryId: true, categoryRef: { select: { name: true, parent: { select: { name: true } } } } } },
      ownerClient: { select: { id: true, name: true, inventoryOnboarded: true } },
      clientLocation: { select: { name: true } },
      location: { select: { id: true, name: true } },
      customFieldValues: { include: { customField: { select: { name: true } } } },
      deployedToContact: { select: { firstName: true, lastName: true } },
      loanedToContact: { select: { firstName: true, lastName: true } },
      assignedUser: { select: { name: true } },
      loanedToClient: { select: { id: true, name: true, inventoryOnboarded: true } },
      overrideVendor: { select: { name: true } },
      overrideManufacturer: { select: { name: true } },
      inventoryAssetEvents: {
        orderBy: { createdAt: "desc" },
        include: { performedByUser: { select: { name: true } } },
      },
    },
  })

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }

  const containerPath = asset.location ? await buildContainerPath(companyId, asset.location.id) : null

  return NextResponse.json({ ...asset, containerPath })
}

// Edits the fields that have no dedicated action modal of their own —
// Serial Number, Warranty, Vendor/Manufacturer overrides, Notes, and
// Custom Field values. Status/Owner/current-holder stay exclusively under
// Check Out/Return/Redeploy/Offboard/Remove, so they're deliberately not
// accepted here even if sent.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "pages.inventory"))) {
    return NextResponse.json({ error: "You don't have access to Inventory" }, { status: 403 })
  }

  const { id } = await params
  const companyId = session.user.companyId
  const body = await req.json()

  const asset = await prisma.inventoryAsset.findUnique({ where: { id, companyId } })
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }

  const serialNumber = typeof body.serialNumber === "string" ? body.serialNumber.trim() : ""
  if (!serialNumber) {
    return NextResponse.json({ error: "Serial number is required" }, { status: 400 })
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

  const updated = await prisma.inventoryAsset.update({
    where: { id },
    data: {
      serialNumber,
      warrantyType: body.warrantyType?.trim() || null,
      warrantyExpiration: body.warrantyExpiration ? new Date(body.warrantyExpiration) : null,
      overrideVendorId: body.overrideVendorId || null,
      overrideVendorSku: body.overrideVendorSku?.trim() || null,
      overrideManufacturerId: body.overrideManufacturerId || null,
      overrideManufacturerSku: body.overrideManufacturerSku?.trim() || null,
      notes: body.notes?.trim() || null,
    },
  })

  if (Array.isArray(body.customFieldValues)) {
    for (const v of body.customFieldValues as { customFieldId?: string; value?: string }[]) {
      if (!v?.customFieldId) continue
      const trimmed = (v.value ?? "").trim()
      if (trimmed) {
        await prisma.inventoryCustomFieldValue.upsert({
          where: { assetId_customFieldId: { assetId: id, customFieldId: v.customFieldId } },
          create: { assetId: id, customFieldId: v.customFieldId, value: trimmed },
          update: { value: trimmed },
        })
      } else {
        await prisma.inventoryCustomFieldValue.deleteMany({ where: { assetId: id, customFieldId: v.customFieldId } })
      }
    }
  }

  await logAssetEvent(id, "FIELD_UPDATED", "Edited asset details", session.user.id)

  return NextResponse.json(updated)
}

// Deployed/loaned/sold/pending-offboard assets tie to real business state
// (a client's hands, a contact, a sale) — those go through Remove instead,
// which keeps the record and its history. Only assets that were never
// deployed (IN_STOCK) or already retired (REMOVED) are safe to hard-delete.
const NON_DELETABLE_STATUSES = ["INTERNAL", "LOANED", "SOLD", "PENDING_OFFBOARD"]

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "inventory.delete"))) {
    return NextResponse.json({ error: "You don't have permission to delete inventory assets" }, { status: 403 })
  }

  const { id } = await params
  const companyId = session.user.companyId

  const asset = await prisma.inventoryAsset.findUnique({ where: { id, companyId } })
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }

  if (NON_DELETABLE_STATUSES.includes(asset.status)) {
    return NextResponse.json(
      { error: "This asset is currently deployed, loaned, or sold. Use Remove instead to retire it, or return/offboard it first." },
      { status: 409 }
    )
  }

  await prisma.inventoryAsset.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}