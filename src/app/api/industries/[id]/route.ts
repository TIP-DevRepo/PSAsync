import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    settingsSection: "company",
    message: "You do not have permission to manage company settings",
  })
  if (response) return response

  const { id } = await params

  const existing = await prisma.industry.findUnique({
    where: { id, companyId: ctx.companyId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Industry not found" }, { status: 404 })
  }

  // Clients referencing this industry keep their row but lose the link —
  // industryId is nullable, so this doesn't cascade-delete any clients.
  await prisma.client.updateMany({
    where: { industryId: id },
    data: { industryId: null },
  })

  await prisma.industry.delete({ where: { id } })

  return NextResponse.json({ success: true })
}