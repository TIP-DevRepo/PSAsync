/*
  Warnings:

  - You are about to drop the column `category` on the `CatalogItem` table. All the data in the column will be lost.
  - You are about to drop the column `subcategory` on the `CatalogItem` table. All the data in the column will be lost.
  - Made the column `categoryId` on table `CatalogItem` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "CatalogItem" DROP CONSTRAINT "CatalogItem_categoryId_fkey";

-- AlterTable
ALTER TABLE "CatalogItem" DROP COLUMN "category",
DROP COLUMN "subcategory",
ALTER COLUMN "categoryId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
