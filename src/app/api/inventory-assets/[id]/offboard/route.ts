import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"

export async function POST(
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

  const asset = await prisma.inventoryAsset.findUnique({ where: { id, companyId } })
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }
  if (asset.status !== "PENDING_OFFBOARD") {
    return NextResponse.json({ error: "This asset isn't pending offboard" }, { status: 400 })
  }

  let locationId = asset.locationId
  let clientLocationId = asset.clientLocationId

  if (body.containerId) {
    const container = await prisma.inventoryLocation.findUnique({
      where: { id: body.containerId, companyId },
      select: { clientLocationId: true },
    })
    if (!container) {
      return NextResponse.json({ error: "Container not found" }, { status: 404 })
    }
    locationId = body.containerId
    clientLocationId = container.clientLocationId
  }

  const wasClientOwned = asset.ownerType === "CLIENT"

  const updated = await prisma.inventoryAsset.update({
    where: { id },
    data: {
      status: "IN_STOCK",
      ownerType: "COMPANY",
      ownerClientId: null,
      locationId,
      clientLocationId,
    },
  })

  await logAssetEvent(
    id,
    "STATUS_CHANGED",
    wasClientOwned ? "Offboarded, ownership transferred back to company" : "Offboarded",
    ctx.userId
  )

  return NextResponse.json(updated)
}