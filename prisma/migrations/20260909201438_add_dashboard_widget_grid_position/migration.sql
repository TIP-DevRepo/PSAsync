-- AlterTable
ALTER TABLE "DashboardWidget"
ADD COLUMN     "col" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "row" INTEGER NOT NULL DEFAULT 0;

-- Backfill the two existing dev-only widgets into non-overlapping cells
-- based on their old creation order, before position is dropped. Safe to
-- run against a fresh database with zero DashboardWidget rows too.
UPDATE "DashboardWidget" SET "row" = 0, "col" = 0 WHERE "id" = 'cmtui1hw100027kpcpkd9mfxf';
UPDATE "DashboardWidget" SET "row" = 0, "col" = 1 WHERE "id" = 'cmtui1uh900037kpchq0pskrp';

-- AlterTable
ALTER TABLE "DashboardWidget" DROP COLUMN "position";
