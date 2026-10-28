-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "clientLocationId" TEXT;

-- CreateIndex
CREATE INDEX "Opportunity_clientLocationId_idx" ON "Opportunity"("clientLocationId");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientLocationId_fkey" FOREIGN KEY ("clientLocationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
