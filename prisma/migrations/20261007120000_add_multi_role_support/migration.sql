-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "color" TEXT,
ADD COLUMN     "isEveryone" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce at most one Everyone role per company. A partial index, same
-- approach as Role_companyId_isGlobalAdmin_key, so companies can still
-- have any number of regular roles.
CREATE UNIQUE INDEX "Role_companyId_isEveryone_key" ON "Role"("companyId") WHERE "isEveryone" = true;

-- The Everyone role can never also be the Global Admin role.
ALTER TABLE "Role" ADD CONSTRAINT "Role_everyone_not_global_admin_check" CHECK (NOT ("isEveryone" AND "isGlobalAdmin"));

-- Data backfill (safe to re-run)

-- (a0) Free up the name "Everyone" in any company that already has a regular
-- role by that name and no Everyone role yet, so (a) can't collide with the
-- (companyId, name) unique index. The renamed role keeps its id, users, and
-- permissions, only its display name changes.
UPDATE "Role" r
SET "name" = 'Everyone (custom)', "updatedAt" = CURRENT_TIMESTAMP
WHERE r."name" = 'Everyone'
  AND r."isEveryone" = false
  AND NOT EXISTS (
    SELECT 1 FROM "Role" e WHERE e."companyId" = r."companyId" AND e."isEveryone" = true
  );

-- (a) One Everyone role per company that doesn't have one yet. Every
-- permission false (same shape new roles get, so the Roles & Permissions
-- panel can render it), and ranked one below the company's current lowest
-- role (and never above -1), so it is always the lowest rank.
INSERT INTO "Role" ("id", "companyId", "name", "rank", "permissions", "isSystem", "isGlobalAdmin", "isEveryone", "createdAt", "updatedAt")
SELECT
  'everyone_' || c."id",
  c."id",
  'Everyone',
  LEAST(0, COALESCE((SELECT MIN(r."rank") FROM "Role" r WHERE r."companyId" = c."id"), 0)) - 1,
  '{"pages": {"clients": false, "catalog": false, "vendors": false, "inventory": false, "quotes": false, "settings": false, "salesOrders": false, "purchaseOrders": false}, "quotes": {"create": false, "edit": false, "delete": false, "changeStatus": false, "approve": false, "sendEmail": false, "viewAllUsersQuotes": false}, "clients": {"create": false, "edit": false, "delete": false, "viewAllClients": false}, "salesOrders": {"create": false, "edit": false, "delete": false, "changeStatus": false, "generatePO": false, "viewAll": false}, "purchaseOrders": {"create": false, "edit": false, "delete": false, "changeStatus": false, "send": false}, "catalog": {"delete": false}, "inventory": {"delete": false}, "settingsSections": {"company": false, "users": false, "quotes": false, "approvalWorkflows": false, "notifications": false, "integrations": false, "salesOrders": false}, "dashboards": {"manage": false}}'::jsonb,
  true,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" e WHERE e."companyId" = c."id" AND e."isEveryone" = true
);

-- (b) Every user with a legacy single role gets a matching UserRole row, so
-- everyone keeps exactly the access they have today. Deterministic ids plus
-- ON CONFLICT make this a no-op when re-run.
INSERT INTO "UserRole" ("id", "userId", "roleId", "createdAt")
SELECT
  'ur_' || md5(u."id" || ':' || u."roleId"),
  u."id",
  u."roleId",
  CURRENT_TIMESTAMP
FROM "User" u
JOIN "Role" r ON r."id" = u."roleId"
WHERE u."roleId" IS NOT NULL
  AND r."isEveryone" = false
ON CONFLICT ("userId", "roleId") DO NOTHING;
