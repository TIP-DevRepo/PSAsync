import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "inventory",
    message: "You do not have permission to edit inventory",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId
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