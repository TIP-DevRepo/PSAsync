-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "nextAssetSequence" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "prefix" TEXT;
