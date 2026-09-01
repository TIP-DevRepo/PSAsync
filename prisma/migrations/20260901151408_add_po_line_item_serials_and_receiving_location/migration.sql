-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "receivingClientLocationId" TEXT;

-- CreateTable
CREATE TABLE "POLineItemSerial" (
    "id" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POLineItemSerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "POLineItemSerial_assetId_key" ON "POLineItemSerial"("assetId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_receivingClientLocationId_fkey" FOREIGN KEY ("receivingClientLocationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POLineItemSerial" ADD CONSTRAINT "POLineItemSerial_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "POLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POLineItemSerial" ADD CONSTRAINT "POLineItemSerial_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
