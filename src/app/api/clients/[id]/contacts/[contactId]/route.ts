import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id, contactId } = await params

  const client = await prisma.client.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const body = await req.json()
  const { firstName, lastName, title, email, phone, mobile, locationType, locationId, notes, isPrimary, tagIds } = body

  if (isPrimary === true) {
    await prisma.contact.updateMany({
      where: { clientId: id, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const contact = await prisma.contact.update({
    where: { id: contactId },
    data: {
      firstName,
      lastName,
      title: title || null,
      email: email || null,
      phone: phone || null,
      mobile: mobile || null,
      locationType,
      locationId: locationId || null,
      notes: notes || null,
      isPrimary: !!isPrimary,
    },
  })

  // Tags are submitted as the full desired set each time (not individual
  // add/remove calls), so the simplest reliable approach is wiping and
  // recreating the assignments rather than diffing old vs new.
  if (tagIds !== undefined) {
    await prisma.contactTagAssignment.deleteMany({ where: { contactId } })
    if (tagIds.length > 0) {
      await prisma.contactTagAssignment.createMany({
        data: tagIds.map((tagId: string) => ({ contactId, contactTagId: tagId })),
      })
    }
  }

  return NextResponse.json(contact)
}