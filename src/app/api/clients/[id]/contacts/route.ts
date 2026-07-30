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
  const body = await req.json()

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

  return NextResponse.json(contact)
}