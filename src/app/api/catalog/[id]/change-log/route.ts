import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const logs = await prisma.catalogItemChangeLog.findMany({
    where: { catalogItemId: id },
    include: { changedByUser: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(logs)
}