import { prisma } from "@/lib/prisma"
import type { InventoryEventType } from "@/generated/prisma"

export async function logAssetEvent(
  assetId: string,
  eventType: InventoryEventType,
  description: string,
  performedByUserId: string
) {
  await prisma.inventoryAssetEvent.create({
    data: { assetId, eventType, description, performedByUserId },
  })
}