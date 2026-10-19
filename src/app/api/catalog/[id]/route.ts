import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ItemType } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs, catalogItemWhere } from "@/lib/scoped-loaders"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "catalog",
    message: "You do not have permission to view the catalog",
  })
  if (response) return response

  const { id } = await params

  const item = await prisma.catalogItem.findUnique({
    where: { id, companyId: ctx.companyId },
    include: {
      categoryRef: { include: { parent: true } },
    },
  })

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 })
  }

  return NextResponse.json(item)
}

const FIELD_LABELS = {
  name: "Item Name",
  description: "Description",
  categoryId: "Category",
  isSerialized: "Serialized",
  type: "Type",
  msrp: "MSRP",
  cost: "Cost Price",
  unit: "Billing Unit",
  taxable: "Taxable",
  active: "Active",
  vendorId: "Vendor",
  vendorSku: "Vendor SKU",
  manufacturerId: "Manufacturer",
  manufacturerSku: "Manufacturer SKU",
}

const TRACKED_FIELDS: { key: keyof typeof FIELD_LABELS; label: string }[] = [
  { key: "name", label: "Item Name" },
  { key: "description", label: "Description" },
  { key: "categoryId", label: "Category" },
  { key: "isSerialized", label: "Serialized" },
  { key: "type", label: "Type" },
  { key: "msrp", label: "MSRP" },
  { key: "cost", label: "Cost Price" },
  { key: "unit", label: "Billing Unit" },
  { key: "taxable", label: "Taxable" },
  { key: "active", label: "Active" },
  { key: "vendorId", label: "Vendor" },
  { key: "vendorSku", label: "Vendor SKU" },
  { key: "manufacturerId", label: "Manufacturer" },
  { key: "manufacturerSku", label: "Manufacturer SKU" },
]

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "Yes" : "No"
  return String(v)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "catalog",
    message: "You do not have permission to edit the catalog",
  })
  if (response) return response

  const { id } = await params
  const body = await req.json()

  const existing = await prisma.catalogItem.findUnique({
    where: catalogItemWhere(ctx, id),
  })
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 })
  }

  // A field left out of the request keeps its stored value, so a partial
  // save can never reset cost (or anything else) to a default
  const has = (key: string) => body[key] !== undefined

  if (has("categoryId")) {
    if (!body.categoryId) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 })
    }
    const category = await prisma.category.findUnique({
      where: { id: body.categoryId, companyId: ctx.companyId },
    })
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 })
    }
  }

  if (body.type !== undefined && !isEnumValue(ItemType, body.type)) {
    return apiError(400, "Invalid item type")
  }
  const invalid = await assertRefs(ctx, { vendorId: body.vendorId, manufacturerId: body.manufacturerId })
  if (invalid) return invalid

  const newValues: Record<string, unknown> = {}
  if (has("name")) newValues.name = body.name
  if (has("description")) newValues.description = body.description || null
  if (has("categoryId")) newValues.categoryId = body.categoryId
  if (has("isSerialized")) newValues.isSerialized = Boolean(body.isSerialized)
  if (has("type")) newValues.type = body.type
  if (has("msrp")) newValues.msrp = Number(body.msrp) || 0
  if (has("cost")) newValues.cost = Number(body.cost) || 0
  if (has("unit")) newValues.unit = body.unit || "each"
  if (has("taxable")) newValues.taxable = body.taxable
  if (has("active")) newValues.active = body.active
  if (has("vendorId")) newValues.vendorId = body.vendorId || null
  if (has("vendorSku")) newValues.vendorSku = body.vendorSku || null
  if (has("manufacturerId")) newValues.manufacturerId = body.manufacturerId || null
  if (has("manufacturerSku")) newValues.manufacturerSku = body.manufacturerSku || null

  // vendorId/manufacturerId store raw IDs — look up both the old and new
  // vendor's names so the log reads "Acme Corp" instead of a cuid.
  const vendorIdsToResolve = [
    existing.vendorId,
    newValues.vendorId,
    existing.manufacturerId,
    newValues.manufacturerId,
  ].filter((v): v is string => typeof v === "string" && !!v)
  const vendorNameMap = new Map<string, string>()
  if (vendorIdsToResolve.length > 0) {
    const vendorRows = await prisma.vendor.findMany({
      where: { id: { in: vendorIdsToResolve }, companyId: ctx.companyId },
      select: { id: true, name: true },
    })
    vendorRows.forEach((v) => vendorNameMap.set(v.id, v.name))
  }

  function displayForField(key: string, value: unknown): string {
    if ((key === "vendorId" || key === "manufacturerId") && typeof value === "string") {
      return vendorNameMap.get(value) ?? displayValue(value)
    }
    return displayValue(value)
  }

  const logEntries: { fieldName: string; oldValue: string; newValue: string }[] = []
  for (const { key, label } of TRACKED_FIELDS) {
    if (!(key in newValues)) continue
    const oldVal = (existing as unknown as Record<string, unknown>)[key]
    const newVal = newValues[key]
    if (oldVal !== newVal) {
      logEntries.push({
        fieldName: label,
        oldValue: displayForField(key, oldVal),
        newValue: displayForField(key, newVal),
      })
    }
  }

  const item = await prisma.catalogItem.update({
    where: catalogItemWhere(ctx, id),
    data: newValues,
  })

  if (logEntries.length > 0) {
    await prisma.catalogItemChangeLog.createMany({
      data: logEntries.map((e) => ({
        catalogItemId: id,
        changedByUserId: ctx.userId,
        fieldName: e.fieldName,
        oldValue: e.oldValue,
        newValue: e.newValue,
      })),
    })
  }

  return NextResponse.json(item)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "catalog.delete",
    message: "You do not have permission to delete catalog items",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId

  const item = await prisma.catalogItem.findUnique({
    where: { id, companyId },
    include: {
      quoteLineItems: { select: { id: true } },
      soLineItems: { select: { id: true } },
      poLineItems: { select: { id: true } },
      inventoryAssets: { select: { id: true } },
      inventoryStocks: { select: { id: true } },
      customPricing: { select: { id: true } },
    },
  })

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 })
  }

  if (item.quoteLineItems.length > 0) {
    return NextResponse.json(
      { error: `This item is used on ${item.quoteLineItems.length} quote(s) and can't be deleted.` },
      { status: 409 }
    )
  }
  if (item.soLineItems.length > 0) {
    return NextResponse.json(
      { error: `This item is used on ${item.soLineItems.length} sales order(s) and can't be deleted.` },
      { status: 409 }
    )
  }
  if (item.poLineItems.length > 0) {
    return NextResponse.json(
      { error: `This item is used on ${item.poLineItems.length} purchase order(s) and can't be deleted.` },
      { status: 409 }
    )
  }
  if (item.inventoryAssets.length > 0) {
    return NextResponse.json(
      { error: `This item has ${item.inventoryAssets.length} inventory asset(s) tracked against it and can't be deleted.` },
      { status: 409 }
    )
  }
  if (item.inventoryStocks.length > 0) {
    return NextResponse.json(
      { error: "This item has pooled inventory stock tracked against it and can't be deleted." },
      { status: 409 }
    )
  }
  if (item.customPricing.length > 0) {
    return NextResponse.json(
      { error: "This item has client-specific custom pricing set up and can't be deleted. Remove that pricing first." },
      { status: 409 }
    )
  }

  await prisma.catalogItem.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}