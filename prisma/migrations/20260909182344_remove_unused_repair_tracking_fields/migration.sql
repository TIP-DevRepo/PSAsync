-- AlterTable
ALTER TABLE "InventoryAsset" DROP COLUMN "repairEstimatedReturnDate",
DROP COLUMN "repairType",
DROP COLUMN "statusBeforeRepair";

-- DropEnum
DROP TYPE "InventoryRepairType";

-- AlterEnum
BEGIN;
CREATE TYPE "InventoryAssetStatus_new" AS ENUM ('IN_STOCK', 'INTERNAL', 'LOANED', 'SOLD', 'PENDING_OFFBOARD', 'REMOVED');
ALTER TABLE "public"."InventoryAsset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "InventoryAsset" ALTER COLUMN "status" TYPE "InventoryAssetStatus_new" USING ("status"::text::"InventoryAssetStatus_new");
ALTER TYPE "InventoryAssetStatus" RENAME TO "InventoryAssetStatus_old";
ALTER TYPE "InventoryAssetStatus_new" RENAME TO "InventoryAssetStatus";
DROP TYPE "public"."InventoryAssetStatus_old";
ALTER TABLE "InventoryAsset" ALTER COLUMN "status" SET DEFAULT 'IN_STOCK';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "InventoryEventType_new" AS ENUM ('CREATED', 'STATUS_CHANGED', 'CHECKED_OUT', 'RETURNED', 'MOVED', 'FIELD_UPDATED');
ALTER TABLE "InventoryAssetEvent" ALTER COLUMN "eventType" TYPE "InventoryEventType_new" USING ("eventType"::text::"InventoryEventType_new");
ALTER TYPE "InventoryEventType" RENAME TO "InventoryEventType_old";
ALTER TYPE "InventoryEventType_new" RENAME TO "InventoryEventType";
DROP TYPE "public"."InventoryEventType_old";
COMMIT;
