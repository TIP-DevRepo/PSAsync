-- CreateEnum
CREATE TYPE "InventorySoldReturnReason" AS ENUM ('REFUND', 'DISPOSAL', 'HOLDING_STOCK');

-- AlterEnum
ALTER TYPE "InventoryAssetStatus" ADD VALUE 'PENDING_OFFBOARD';

-- AlterTable
ALTER TABLE "InventoryAsset" ADD COLUMN     "deployedToContactId" TEXT,
ADD COLUMN     "pendingDisposal" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_deployedToContactId_fkey" FOREIGN KEY ("deployedToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
