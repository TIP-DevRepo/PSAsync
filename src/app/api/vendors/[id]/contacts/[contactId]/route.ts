import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadVendorContact, vendorContactWhere } from "@/lib/scoped-loaders"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, contactId } = await params
  const existing = await loadVendorContact(ctx, id, contactId)
  if (!existing) return notFound()

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

  const contact = await prisma.vendorContact.update({ where: vendorContactWhere(ctx, id, contactId), data })

  return NextResponse.json(contact)
}
