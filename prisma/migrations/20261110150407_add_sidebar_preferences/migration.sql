-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "allowUserSidebar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sidebarLayout" JSONB;

-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN     "sidebarLayout" JSONB;
