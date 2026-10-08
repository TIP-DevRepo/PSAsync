import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { clientLocationWhere, loadClientLocation } from "@/lib/scoped-loaders"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, locationId } = await params

  const existing = await loadClientLocation(ctx, id, locationId)
  if (!existing) return notFound()

  const body = await req.json()
  const { name, address, address2, city, state, zip, country, phone, notes, isPrimary, billingContactId, shippingContactId } = body

  // Setting this location as primary means unsetting whichever one
  // currently holds that flag — only one primary per client.
  if (isPrimary === true) {
    await prisma.clientLocation.updateMany({
      where: { clientId: id, client: { companyId: ctx.companyId }, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const location = await prisma.clientLocation.update({
    where: clientLocationWhere(ctx, id, locationId),
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
