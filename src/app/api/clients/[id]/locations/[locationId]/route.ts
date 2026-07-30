import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id, locationId } = await params

  const client = await prisma.client.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const body = await req.json()
  const { name, address, address2, city, state, zip, country, phone, notes, isPrimary, billingContactId, shippingContactId } = body

  // Setting this location as primary means unsetting whichever one
  // currently holds that flag — only one primary per client.
  if (isPrimary === true) {
    await prisma.clientLocation.updateMany({
      where: { clientId: id, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const location = await prisma.clientLocation.update({
    where: { id: locationId },
    data: {
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