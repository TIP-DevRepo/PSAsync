import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { clientContactWhere, loadClientContact } from "@/lib/scoped-loaders"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, contactId } = await params

  const existing = await loadClientContact(ctx, id, contactId)
  if (!existing) return notFound()

  const body = await req.json()
  const { firstName, lastName, title, email, phone, mobile, locationType, locationId, notes, isPrimary, tagIds } = body

  if (isPrimary === true) {
    await prisma.contact.updateMany({
      where: { clientId: id, client: { companyId: ctx.companyId }, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const contact = await prisma.contact.update({
    where: clientContactWhere(ctx, id, contactId),
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
