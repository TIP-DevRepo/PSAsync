import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { assertRefs, loadClient } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const client = await loadClient(ctx, id)
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const body = await req.json()
  const { name, address, address2, city, state, zip, country, phone, notes, isPrimary, billingContactId, shippingContactId } = body

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Location name is required" }, { status: 400 })
  }

  // Billing and shipping contacts must be contacts of this same client
  const invalid = await assertRefs(ctx, { clientId: id, contactId: [billingContactId, shippingContactId] })
  if (invalid) return invalid

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