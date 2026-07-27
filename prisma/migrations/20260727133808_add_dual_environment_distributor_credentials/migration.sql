/*
  Warnings:

  - You are about to drop the column `apiKey` on the `DistributorIntegration` table. All the data in the column will be lost.
  - You are about to drop the column `clientId` on the `DistributorIntegration` table. All the data in the column will be lost.
  - You are about to drop the column `clientSecret` on the `DistributorIntegration` table. All the data in the column will be lost.
  - You are about to drop the column `lastTestStatus` on the `DistributorIntegration` table. All the data in the column will be lost.
  - You are about to drop the column `lastTestedAt` on the `DistributorIntegration` table. All the data in the column will be lost.
  - You are about to drop the column `partnerId` on the `DistributorIntegration` table. All the data in the column will be lost.
  - You are about to drop the column `sandboxMode` on the `DistributorIntegration` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DistributorEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- AlterTable
ALTER TABLE "DistributorIntegration" DROP COLUMN "apiKey",
DROP COLUMN "clientId",
DROP COLUMN "clientSecret",
DROP COLUMN "lastTestStatus",
DROP COLUMN "lastTestedAt",
DROP COLUMN "partnerId",
DROP COLUMN "sandboxMode",
ADD COLUMN     "activeEnvironment" "DistributorEnvironment" NOT NULL DEFAULT 'SANDBOX',
ADD COLUMN     "productionApiKey" TEXT,
ADD COLUMN     "productionClientId" TEXT,
ADD COLUMN     "productionClientSecret" TEXT,
ADD COLUMN     "productionLastTestStatus" TEXT,
ADD COLUMN     "productionLastTestedAt" TIMESTAMP(3),
ADD COLUMN     "productionPartnerId" TEXT,
ADD COLUMN     "sandboxApiKey" TEXT,
ADD COLUMN     "sandboxClientId" TEXT,
ADD COLUMN     "sandboxClientSecret" TEXT,
ADD COLUMN     "sandboxLastTestStatus" TEXT,
ADD COLUMN     "sandboxLastTestedAt" TIMESTAMP(3),
ADD COLUMN     "sandboxPartnerId" TEXT;
