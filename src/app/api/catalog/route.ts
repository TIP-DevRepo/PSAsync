import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ItemType } from "@/generated/prisma"
import { apiError, canSeeCost, isEnumValue, omitCost, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"

// Open to any active user: the quote, sales order, purchase order, template,
// and inventory forms pick items from this list. Cost is left out for users
// who can't see it.
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const items = await prisma.catalogItem.findMany({
    where: { companyId: ctx.companyId },
    select: {
      id: true,
      name: true,
      description: true,
      categoryId: true,
      categoryRef: { select: { name: true, parent: { select: { name: true } } } },
      isSerialized: true,
      type: true,
      msrp: true,
      cost: true,
      taxable: true,
      active: true,
      vendorId: true,
      vendor: { select: { id: true, name: true } },
      vendorSku: true,
      manufacturerId: true,
      manufacturer: { select: { id: true, name: true } },
      manufacturerSku: true,
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(canSeeCost(ctx) ? items : items.map(omitCost))
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    page: "catalog",
    message: "You do not have permission to edit the catalog",
  })
  if (response) return response

  const body = await req.json()

  if (!body.categoryId) {
    return NextResponse.json({ error: "Category is required" }, { status: 400 })
  }

  const category = await prisma.category.findUnique({
    where: { id: body.categoryId, companyId: ctx.companyId },
  })
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  if (body.type && !isEnumValue(ItemType, body.type)) {
    return apiError(400, "Invalid item type")
  }
  const invalid = await assertRefs(ctx, { vendorId: body.vendorId, manufacturerId: body.manufacturerId })
  if (invalid) return invalid

  const item = await prisma.catalogItem.create({
    data: {
      companyId: ctx.companyId,
      vendorId: body.vendorId || null,
      vendorSku: body.vendorSku || null,
      manufacturerId: body.manufacturerId || null,
      manufacturerSku: body.manufacturerSku || null,
      name: body.name,
      description: body.description || null,
      categoryId: body.categoryId,
      isSerialized: Boolean(body.isSerialized),
      type: body.type || "PHYSICAL",
      msrp: Number(body.msrp) || 0,
      cost: Number(body.cost) || 0,
      unit: body.unit || "each",
      taxable: body.taxable ?? true,
      active: body.active ?? true,
    },
    include: {
      categoryRef: { select: { name: true, parent: { select: { name: true } } } },
    },
  })

  return NextResponse.json(item)
}