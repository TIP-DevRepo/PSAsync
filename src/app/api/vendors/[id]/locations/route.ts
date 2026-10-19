import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "vendors",
    message: "You do not have permission to edit vendors",
  })
  if (response) return response

  const { id } = await params
  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: ctx.companyId },
    select: { id: true },
  })
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  const body = await req.json()

  const location = await prisma.vendorLocation.create({
    data: {
      vendorId: id,
      name: body.name,
      address: body.address || null,
      address2: body.address2 || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      country: body.country || null,
      phone: body.phone || null,
      notes: body.notes || null,
      isPrimary: body.isPrimary || false,
    },
  })

  return NextResponse.json(location)
}