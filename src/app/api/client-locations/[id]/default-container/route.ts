import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId
  const body = await req.json()
  const containerId: string | null = body.containerId || null

  const clientLocation = await prisma.clientLocation.findFirst({
    where: { id, client: { companyId } },
  })
  if (!clientLocation) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 })
  }

  if (containerId) {
    // Must belong to this exact site's own Container tree.
    const container = await prisma.inventoryLocation.findUnique({
      where: { id: containerId, companyId, clientLocationId: id },
    })
    if (!container) {
      return NextResponse.json({ error: "Container not found" }, { status: 404 })
    }
  }

  const updated = await prisma.clientLocation.update({
    where: { id },
    data: { defaultContainerId: containerId },
  })

  return NextResponse.json(updated)
}