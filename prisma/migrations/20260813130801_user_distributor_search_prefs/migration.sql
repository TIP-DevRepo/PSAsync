-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredDistributors" TEXT[] DEFAULT ARRAY[]::TEXT[];
