import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { VendorStatus, VendorType } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"

// Open to any active user: catalog, sales order, purchase order, and
// inventory forms pick vendors from this list
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const vendors = await prisma.vendor.findMany({
    where: { companyId: ctx.companyId },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      email: true,
      phone: true,
      isDistributor: true,
      isVendor: true,
      isManufacturer: true,
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(vendors)
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to edit vendors",
  })
  if (response) return response

  const body = await req.json()

  if (body.type && !isEnumValue(VendorType, body.type)) {
    return apiError(400, "Invalid vendor type")
  }
  if (body.status && !isEnumValue(VendorStatus, body.status)) {
    return apiError(400, "Invalid status")
  }

  const vendor = await prisma.vendor.create({
    data: {
      companyId: ctx.companyId,
      name: body.name,
      type: body.type || "SUPPLIER",
      status: body.status || "ACTIVE",
      email: body.email || null,
      phone: body.phone || null,
      website: body.website || null,
      address: body.address || null,
      paymentTerms: body.paymentTerms || null,
      leadTimeDays: body.leadTimeDays ? Number(body.leadTimeDays) : null,
      notes: body.notes || null,
      isDistributor: body.isDistributor || false,
      isVendor: body.isVendor ?? true,
      isManufacturer: body.isManufacturer || false,
    },
  })

  return NextResponse.json(vendor)
}