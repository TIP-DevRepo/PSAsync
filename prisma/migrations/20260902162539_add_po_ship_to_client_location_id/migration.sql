-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "shipToClientLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_shipToClientLocationId_fkey" FOREIGN KEY ("shipToClientLocationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
