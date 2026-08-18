import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const item = await prisma.catalogItem.findUnique({
    where: { id, companyId: session.user.companyId },
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
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  const existing = await prisma.catalogItem.findUnique({
    where: { id, companyId: session.user.companyId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 })
  }

  if (!body.categoryId) {
    return NextResponse.json({ error: "Category is required" }, { status: 400 })
  }

  const category = await prisma.category.findUnique({
    where: { id: body.categoryId, companyId: session.user.companyId },
  })
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  const newValues = {
    name: body.name,
    description: body.description || null,
    categoryId: body.categoryId,
    type: body.type,
    msrp: Number(body.msrp) || 0,
    cost: Number(body.cost) || 0,
    unit: body.unit || "each",
    taxable: body.taxable,
    active: body.active,
    vendorId: body.vendorId || null,
    vendorSku: body.vendorSku || null,
    manufacturerId: body.manufacturerId || null,
    manufacturerSku: body.manufacturerSku || null,
  }

  // vendorId/manufacturerId store raw IDs — look up both the old and new
  // vendor's names so the log reads "Acme Corp" instead of a cuid.
  const vendorIdsToResolve = [
    existing.vendorId,
    newValues.vendorId,
    existing.manufacturerId,
    newValues.manufacturerId,
  ].filter((v): v is string => !!v)
  const vendorNameMap = new Map<string, string>()
  if (vendorIdsToResolve.length > 0) {
    const vendorRows = await prisma.vendor.findMany({
      where: { id: { in: vendorIdsToResolve } },
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
    const oldVal = (existing as unknown as Record<string, unknown>)[key]
    const newVal = (newValues as unknown as Record<string, unknown>)[key]
    if (oldVal !== newVal) {
      logEntries.push({
        fieldName: label,
        oldValue: displayForField(key, oldVal),
        newValue: displayForField(key, newVal),
      })
    }
  }

  const item = await prisma.catalogItem.update({
    where: { id, companyId: session.user.companyId },
    data: newValues,
  })

  if (logEntries.length > 0) {
    await prisma.catalogItemChangeLog.createMany({
      data: logEntries.map((e) => ({
        catalogItemId: id,
        changedByUserId: session.user.id,
        fieldName: e.fieldName,
        oldValue: e.oldValue,
        newValue: e.newValue,
      })),
    })
  }

  return NextResponse.json(item)
}