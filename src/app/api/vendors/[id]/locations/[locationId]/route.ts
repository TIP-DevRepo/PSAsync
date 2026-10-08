import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess, notFound } from "@/lib/api-access"
import { loadVendorLocation, vendorLocationWhere } from "@/lib/scoped-loaders"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id, locationId } = await params
  const existing = await loadVendorLocation(ctx, id, locationId)
  if (!existing) return notFound()

  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.address !== undefined) data.address = body.address || null
  if (body.address2 !== undefined) data.address2 = body.address2 || null
  if (body.city !== undefined) data.city = body.city || null
  if (body.state !== undefined) data.state = body.state || null
  if (body.zip !== undefined) data.zip = body.zip || null
  if (body.country !== undefined) data.country = body.country || null
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.notes !== undefined) data.notes = body.notes || null
  if (body.isPrimary !== undefined) data.isPrimary = body.isPrimary

  const location = await prisma.vendorLocation.update({ where: vendorLocationWhere(ctx, id, locationId), data })

  return NextResponse.json(location)
}
