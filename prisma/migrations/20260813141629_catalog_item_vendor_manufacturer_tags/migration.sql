-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "manufacturerId" TEXT,
ADD COLUMN     "manufacturerSku" TEXT,
ADD COLUMN     "vendorSku" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "isManufacturer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVendor" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
