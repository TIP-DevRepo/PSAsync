-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "shipAddress" TEXT,
ADD COLUMN     "shipAddress2" TEXT,
ADD COLUMN     "shipCity" TEXT,
ADD COLUMN     "shipContactName" TEXT,
ADD COLUMN     "shipCountry" TEXT,
ADD COLUMN     "shipState" TEXT,
ADD COLUMN     "shipToClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shipZip" TEXT;
