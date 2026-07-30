import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const existing = await prisma.industry.findUnique({
    where: { id, companyId: session.user.companyId },
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