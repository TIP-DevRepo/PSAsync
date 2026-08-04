-- DropForeignKey
ALTER TABLE "SalesOrder" DROP CONSTRAINT "SalesOrder_quoteId_fkey";

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "billAddress" TEXT,
ADD COLUMN     "billAddress2" TEXT,
ADD COLUMN     "billCity" TEXT,
ADD COLUMN     "billContactName" TEXT,
ADD COLUMN     "billCountry" TEXT,
ADD COLUMN     "billState" TEXT,
ADD COLUMN     "billZip" TEXT,
ADD COLUMN     "shipAddress2" TEXT,
ADD COLUMN     "shipContactName" TEXT,
ALTER COLUMN "quoteId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
