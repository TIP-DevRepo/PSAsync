-- CreateEnum
CREATE TYPE "InventoryEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'CHECKED_OUT', 'RETURNED', 'MOVED', 'REPAIR_STARTED', 'REPAIR_COMPLETED', 'FIELD_UPDATED');

-- CreateEnum
CREATE TYPE "InventoryStockEventType" AS ENUM ('RECEIVED', 'CHECKED_OUT', 'ADJUSTED', 'MOVED');

-- CreateTable
CREATE TABLE "InventoryAssetEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "eventType" "InventoryEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "performedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStockEvent" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "eventType" "InventoryStockEventType" NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "performedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryStockEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InventoryAssetEvent" ADD CONSTRAINT "InventoryAssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAssetEvent" ADD CONSTRAINT "InventoryAssetEvent_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockEvent" ADD CONSTRAINT "InventoryStockEvent_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "InventoryStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStockEvent" ADD CONSTRAINT "InventoryStockEvent_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
