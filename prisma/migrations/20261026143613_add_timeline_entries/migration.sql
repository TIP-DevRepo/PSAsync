/*
  Warnings:

  - You are about to drop the column `notes` on the `Opportunity` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TimelineEntryKind" AS ENUM ('NOTE', 'ACTION', 'EMAIL_OUT', 'EMAIL_IN');

-- AlterTable
ALTER TABLE "Opportunity" DROP COLUMN "notes";

-- CreateTable
CREATE TABLE "TimelineEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "kind" "TimelineEntryKind" NOT NULL,
    "authorId" TEXT,
    "body" TEXT,
    "action" TEXT,
    "data" JSONB,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineEntry_companyId_idx" ON "TimelineEntry"("companyId");

-- CreateIndex
CREATE INDEX "TimelineEntry_opportunityId_createdAt_idx" ON "TimelineEntry"("opportunityId", "createdAt");

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
