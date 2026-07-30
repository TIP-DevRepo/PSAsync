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

  const client = await prisma.client.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const body = await req.json()
  const { name, address, address2, city, state, zip, country, phone, notes, isPrimary, billingContactId, shippingContactId } = body

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Location name is required" }, { status: 400 })
  }

  // Only one location can be primary at a time — unset any existing
  // primary before creating this one, same enforcement pattern a
  // "primary contact" flag would need.
  if (isPrimary) {
    await prisma.clientLocation.updateMany({
      where: { clientId: id, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const location = await prisma.clientLocation.create({
    data: {
      clientId: id,
      name,
      address: address || null,
      address2: address2 || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      country: country || null,
      phone: phone || null,
      notes: notes || null,
      isPrimary: !!isPrimary,
      billingContactId: billingContactId || null,
      shippingContactId: shippingContactId || null,
    },
  })

  return NextResponse.json(location)
}