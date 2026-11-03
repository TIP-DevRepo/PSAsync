/*
  Warnings:

  - A unique constraint covering the columns `[companyId,poNumber]` on the table `PurchaseOrder` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,quoteNumber,version]` on the table `Quote` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,soNumber]` on the table `SalesOrder` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_companyId_key_key" ON "NumberSequence"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_poNumber_key" ON "PurchaseOrder"("companyId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_companyId_quoteNumber_version_key" ON "Quote"("companyId", "quoteNumber", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_soNumber_key" ON "SalesOrder"("companyId", "soNumber");

-- AddForeignKey
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
