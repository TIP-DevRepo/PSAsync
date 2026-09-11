-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultDashboardId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultDashboardId_fkey" FOREIGN KEY ("defaultDashboardId") REFERENCES "Dashboard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
