import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const items = await prisma.catalogItem.findMany({
    where: { companyId: session.user.companyId },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      type: true,
      msrp: true,
      cost: true,
      taxable: true,
      active: true,
      vendorId: true,
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()

  const item = await prisma.catalogItem.create({
    data: {
      companyId: session.user.companyId,
      vendorId: body.vendorId || null,
      name: body.name,
      description: body.description || null,
      sku: body.sku || null,
      category: body.category || null,
      subcategory: body.subcategory || null,
      type: body.type || "PHYSICAL",
      msrp: Number(body.msrp) || 0,
      cost: Number(body.cost) || 0,
      unit: body.unit || "each",
      taxable: body.taxable ?? true,
      active: body.active ?? true,
    },
  })

  return NextResponse.json(item)
}