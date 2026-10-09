import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ContactLocationType } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess, notFound } from "@/lib/api-access"
import { assertRefs, loadClient } from "@/lib/scoped-loaders"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params
  const client = await loadClient(ctx, id)
  if (!client) return notFound()

  const body = await req.json()

  if (body.locationType && !isEnumValue(ContactLocationType, body.locationType)) {
    return apiError(400, "Invalid location type")
  }
  // The location must be one of this client's, and tags the company's own
  const invalid = await assertRefs(ctx, { clientId: id, clientLocationId: body.locationId, tagIds: body.tagIds })
  if (invalid) return invalid

  // Only one contact can be primary at a time
  if (body.isPrimary) {
    await prisma.contact.updateMany({
      where: { clientId: id, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const contact = await prisma.contact.create({
    data: {
      clientId: id,
      firstName: body.firstName,
      lastName: body.lastName,
      title: body.title || null,
      email: body.email || null,
      phone: body.phone || null,
      mobile: body.mobile || null,
      locationType: body.locationType || "IN_OFFICE",
      locationId: body.locationId || null,
      notes: body.notes || null,
      isPrimary: body.isPrimary || false,
    },
  })

  if (body.tagIds?.length > 0) {
    await prisma.contactTagAssignment.createMany({
      data: (body.tagIds as string[]).map((tagId) => ({ contactId: contact.id, contactTagId: tagId })),
    })
  }

  return NextResponse.json(contact)
}