-- AlterTable
ALTER TABLE "ClientLocation" ADD COLUMN     "defaultContainerId" TEXT;

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_defaultContainerId_fkey" FOREIGN KEY ("defaultContainerId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
