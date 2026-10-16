import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { logAssetEvent } from "@/lib/inventory/logAssetEvent"

const VALID_REASONS = ["BROKEN_SCRAPPED", "LOST", "DONATED", "RETURNED_TO_VENDOR", "OTHER"]

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    page: "inventory",
    permission: "inventory.delete",
    message: "You do not have permission to remove inventory assets",
  })
  if (response) return response

  const { id } = await params
  const companyId = ctx.companyId
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

  await logAssetEvent(id, "STATUS_CHANGED", `Removed: ${body.reason.replace(/_/g, " ").toLowerCase()}`, ctx.userId)

  return NextResponse.json(updated)
}