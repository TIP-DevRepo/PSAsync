import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { assertRefs, loadVendor } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const vendor = await loadVendor(ctx, id)
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
  }

  const body = await req.json()

  // The location must be one of this vendor's
  const invalid = await assertRefs(ctx, { vendorId: id, vendorLocationId: body.locationId })
  if (invalid) return invalid

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