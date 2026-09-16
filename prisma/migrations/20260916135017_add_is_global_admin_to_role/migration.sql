-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "isGlobalAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Enforce at most one Global Admin role per company. A partial index
-- (rather than a plain @@unique([companyId, isGlobalAdmin])) so companies
-- can still have any number of non-Global-Admin roles.
CREATE UNIQUE INDEX "Role_companyId_isGlobalAdmin_key" ON "Role"("companyId") WHERE "isGlobalAdmin" = true;
