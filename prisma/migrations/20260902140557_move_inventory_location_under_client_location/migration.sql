/*
  Warnings:

  - Added the required column `clientLocationId` to the `InventoryLocation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "inventoryOnboarded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InventoryLocation" ADD COLUMN     "clientLocationId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_clientLocationId_fkey" FOREIGN KEY ("clientLocationId") REFERENCES "ClientLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
