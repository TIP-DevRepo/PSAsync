-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "usesOpportunities" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "usesTickets" BOOLEAN NOT NULL DEFAULT true;
