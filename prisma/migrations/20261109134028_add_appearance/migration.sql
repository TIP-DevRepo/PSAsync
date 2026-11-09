-- CreateEnum
CREATE TYPE "ThemeSidebarStyle" AS ENUM ('DARK', 'LIGHT', 'TINTED');

-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RowDensity" AS ENUM ('COMPACT', 'DEFAULT', 'COMFORTABLE');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "allowUserTheme" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "themeAccent" TEXT,
ADD COLUMN     "themeMode" "ThemeMode",
ADD COLUMN     "themeSidebar" "ThemeSidebarStyle";

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "themeAccent" TEXT,
    "themeSidebar" "ThemeSidebarStyle",
    "themeMode" "ThemeMode",
    "rowDensity" "RowDensity",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
