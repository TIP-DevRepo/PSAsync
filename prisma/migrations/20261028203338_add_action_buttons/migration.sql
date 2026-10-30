-- CreateEnum
CREATE TYPE "ActionButtonKind" AS ENUM ('NOTE', 'EMAIL', 'RAISE_QUOTE', 'APPOINTMENT', 'CHILD_TICKET');

-- CreateEnum
CREATE TYPE "ActionStageMode" AS ENUM ('NONE', 'CHOOSE', 'FIXED');

-- CreateEnum
CREATE TYPE "ActionNoteMode" AS ENUM ('OPTIONAL', 'REQUIRED');

-- CreateTable
CREATE TABLE "ActionButton" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "forOpportunities" BOOLEAN NOT NULL DEFAULT true,
    "forTickets" BOOLEAN NOT NULL DEFAULT false,
    "kind" "ActionButtonKind" NOT NULL,
    "stageMode" "ActionStageMode" NOT NULL DEFAULT 'NONE',
    "fixedStageId" TEXT,
    "noteMode" "ActionNoteMode" NOT NULL DEFAULT 'REQUIRED',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionButton_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionButton_companyId_idx" ON "ActionButton"("companyId");

-- AddForeignKey
ALTER TABLE "ActionButton" ADD CONSTRAINT "ActionButton_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionButton" ADD CONSTRAINT "ActionButton_fixedStageId_fkey" FOREIGN KEY ("fixedStageId") REFERENCES "OpportunityStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
