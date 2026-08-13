import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { locationId } = await params
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

  const location = await prisma.vendorLocation.update({ where: { id: locationId }, data })

  return NextResponse.json(location)
}