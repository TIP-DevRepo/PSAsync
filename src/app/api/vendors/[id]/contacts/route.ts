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

  const contact = await prisma.vendorContact.create({
    data: {
      vendorId: id,
      firstName: body.firstName,
      lastName: body.lastName,
      title: body.title || null,
      email: body.email || null,
      phone: body.phone || null,
      mobile: body.mobile || null,
      locationId: body.locationId || null,
      notes: body.notes || null,
      isPrimary: body.isPrimary || false,
    },
  })

  return NextResponse.json(contact)
}