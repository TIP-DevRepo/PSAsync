import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"

const VALID_REASONS = ["BROKEN_SCRAPPED", "LOST", "DONATED", "RETURNED_TO_VENDOR", "OTHER"]

export async function POST(
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

  if (!VALID_REASONS.includes(body.reason)) {
    return NextResponse.json({ error: "A valid reason is required" }, { status: 400 })
  }

  const asset = await prisma.inventoryAsset.findUnique({ where: { id, companyId } })
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }
  if (asset.status === "REMOVED") {
    return NextResponse.json({ error: "This asset is already removed" }, { status: 400 })
  }

  // Ownership/location are left as-is — kept as a historical record of
  // wherever the asset currently lived when it was removed.
  const updated = await prisma.inventoryAsset.update({
    where: { id },
    data: { status: "REMOVED", removedReason: body.reason },
  })

  await logAssetEvent(id, "STATUS_CHANGED", `Removed: ${body.reason.replace(/_/g, " ").toLowerCase()}`, session.user.id)

  return NextResponse.json(updated)
}