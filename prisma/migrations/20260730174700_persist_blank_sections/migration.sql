-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "sections" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "QuoteTemplate" ADD COLUMN     "sections" TEXT[] DEFAULT ARRAY[]::TEXT[];
