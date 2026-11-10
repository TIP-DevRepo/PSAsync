/*
  Warnings:

  - You are about to drop the `SavedView` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SavedView" DROP CONSTRAINT "SavedView_companyId_fkey";

-- DropForeignKey
ALTER TABLE "SavedView" DROP CONSTRAINT "SavedView_userId_fkey";

-- DropTable
DROP TABLE "SavedView";
