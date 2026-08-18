-- CreateTable
CREATE TABLE "ContactTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTagAssignment" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactTagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactTag_companyId_name_key" ON "ContactTag"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ContactTagAssignment_contactId_contactTagId_key" ON "ContactTagAssignment"("contactId", "contactTagId");

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTagAssignment" ADD CONSTRAINT "ContactTagAssignment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTagAssignment" ADD CONSTRAINT "ContactTagAssignment_contactTagId_fkey" FOREIGN KEY ("contactTagId") REFERENCES "ContactTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
