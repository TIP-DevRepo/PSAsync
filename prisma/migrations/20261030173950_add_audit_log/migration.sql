-- CreateEnum
CREATE TYPE "AuditRecordType" AS ENUM ('OPPORTUNITY', 'TICKET', 'QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordType" "AuditRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "recordLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "before" JSONB,
    "after" JSONB,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "undoOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLogEntry_companyId_createdAt_idx" ON "AuditLogEntry"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLogEntry_companyId_recordType_recordId_createdAt_idx" ON "AuditLogEntry"("companyId", "recordType", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_deletedAt_idx" ON "Opportunity"("companyId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_undoneById_fkey" FOREIGN KEY ("undoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
