-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "shipToClientId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_shipToClientId_fkey" FOREIGN KEY ("shipToClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
