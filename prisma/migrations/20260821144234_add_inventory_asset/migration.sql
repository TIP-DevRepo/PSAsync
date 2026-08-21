-- CreateEnum
CREATE TYPE "InventoryAssetStatus" AS ENUM ('IN_STOCK', 'INTERNAL', 'LOANED', 'SOLD', 'IN_REPAIR', 'REMOVED');

-- CreateEnum
CREATE TYPE "InventoryOwnerType" AS ENUM ('COMPANY', 'CLIENT');

-- CreateEnum
CREATE TYPE "InventoryRemovedReason" AS ENUM ('BROKEN_SCRAPPED', 'LOST', 'DONATED', 'RETURNED_TO_VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryRepairType" AS ENUM ('SELF', 'VENDOR');

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "isSerialized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "InventoryAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" "InventoryAssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "ownerType" "InventoryOwnerType" NOT NULL DEFAULT 'COMPANY',
    "ownerClientId" TEXT,
    "locationId" TEXT,
    "clientLocationId" TEXT,
    "assignedUserId" TEXT,
    "loanedToClientId" TEXT,
    "loanedToContactId" TEXT,
    "loanExpectedReturnDate" TIMESTAMP(3),
    "removedReason" "InventoryRemovedReason",
    "repairType" "InventoryRepairType",
    "repairEstimatedReturnDate" TIMESTAMP(3),
    "statusBeforeRepair" "InventoryAssetStatus",
    "warrantyType" TEXT,
    "warrantyExpiration" TIMESTAMP(3),
    "overrideVendorId" TEXT,
    "overrideVendorSku" TEXT,
    "overrideManufacturerId" TEXT,
    "overrideManufacturerSku" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCustomFieldValue" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAsset_companyId_assetTag_key" ON "InventoryAsset"("companyId", "assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCustomFieldValue_assetId_customFieldId_key" ON "InventoryCustomFieldValue"("assetId", "customFieldId");

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_ownerClientId_fkey" FOREIGN KEY ("ownerClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_clientLocationId_fkey" FOREIGN KEY ("clientLocationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_loanedToClientId_fkey" FOREIGN KEY ("loanedToClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_loanedToContactId_fkey" FOREIGN KEY ("loanedToContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_overrideVendorId_fkey" FOREIGN KEY ("overrideVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_overrideManufacturerId_fkey" FOREIGN KEY ("overrideManufacturerId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustomFieldValue" ADD CONSTRAINT "InventoryCustomFieldValue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCustomFieldValue" ADD CONSTRAINT "InventoryCustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "InventoryCustomField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
