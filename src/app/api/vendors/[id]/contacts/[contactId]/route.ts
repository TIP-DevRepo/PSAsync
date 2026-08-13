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

  const { contactId } = await params
  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.firstName !== undefined) data.firstName = body.firstName
  if (body.lastName !== undefined) data.lastName = body.lastName
  if (body.title !== undefined) data.title = body.title || null
  if (body.email !== undefined) data.email = body.email || null
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.mobile !== undefined) data.mobile = body.mobile || null
  if (body.locationId !== undefined) data.locationId = body.locationId || null
  if (body.notes !== undefined) data.notes = body.notes || null
  if (body.isPrimary !== undefined) data.isPrimary = body.isPrimary

  const contact = await prisma.vendorContact.update({ where: { id: contactId }, data })

  return NextResponse.json(contact)
}