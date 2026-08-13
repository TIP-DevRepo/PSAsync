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

  const vendor = await prisma.vendor.findUnique({
    where: { id, companyId: session.user.companyId },
    include: {
      locations: true,
      contacts: true,
    },
  })

  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  return NextResponse.json(vendor)
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
  const companyId = session.user.companyId
  const body = await req.json()

  const existing = await prisma.vendor.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.type !== undefined) data.type = body.type
  if (body.status !== undefined) data.status = body.status
  if (body.email !== undefined) data.email = body.email || null
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.website !== undefined) data.website = body.website || null
  if (body.address !== undefined) data.address = body.address || null
  if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms || null
  if (body.leadTimeDays !== undefined) data.leadTimeDays = body.leadTimeDays ? Number(body.leadTimeDays) : null
  if (body.notes !== undefined) data.notes = body.notes || null
  if (body.isDistributor !== undefined) data.isDistributor = body.isDistributor
  if (body.isVendor !== undefined) data.isVendor = body.isVendor
  if (body.isManufacturer !== undefined) data.isManufacturer = body.isManufacturer

  const vendor = await prisma.vendor.update({ where: { id }, data })

  return NextResponse.json(vendor)
}