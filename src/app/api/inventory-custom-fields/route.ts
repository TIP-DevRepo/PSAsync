import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

// Open to any active user: the inventory asset forms read these
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const fields = await prisma.inventoryCustomField.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, name: true, categoryId: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(fields)
}