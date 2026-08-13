import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: session.user.companyId },
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