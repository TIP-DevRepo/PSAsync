/*
  Warnings:

  - You are about to drop the column `billAddress` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `billCity` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `billCountry` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `billState` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `billZip` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `shipAddress` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `shipCity` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `shipCountry` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `shipState` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `shipZip` on the `Client` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ContactLocationType" AS ENUM ('REMOTE', 'IN_OFFICE');

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "billAddress",
DROP COLUMN "billCity",
DROP COLUMN "billCountry",
DROP COLUMN "billState",
DROP COLUMN "billZip",
DROP COLUMN "shipAddress",
DROP COLUMN "shipCity",
DROP COLUMN "shipCountry",
DROP COLUMN "shipState",
DROP COLUMN "shipZip",
ADD COLUMN     "mainBillingLocationId" TEXT,
ADD COLUMN     "mainShippingLocationId" TEXT;

-- AlterTable
ALTER TABLE "ClientLocation" ADD COLUMN     "billingContactId" TEXT,
ADD COLUMN     "shippingContactId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "locationType" "ContactLocationType" NOT NULL DEFAULT 'IN_OFFICE';

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_mainBillingLocationId_fkey" FOREIGN KEY ("mainBillingLocationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_mainShippingLocationId_fkey" FOREIGN KEY ("mainShippingLocationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_billingContactId_fkey" FOREIGN KEY ("billingContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_shippingContactId_fkey" FOREIGN KEY ("shippingContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
