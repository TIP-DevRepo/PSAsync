import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const locations = await prisma.inventoryLocation.findMany({
    where: { companyId: session.user.companyId },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(locations)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId
  const body = await req.json()
  const name = (body.name ?? "").trim()
  const parentId = body.parentId || null

  if (!name) {
    return NextResponse.json({ error: "Location name is required" }, { status: 400 })
  }

  if (parentId) {
    const parent = await prisma.inventoryLocation.findUnique({ where: { id: parentId, companyId } })
    if (!parent) {
      return NextResponse.json({ error: "Parent location not found" }, { status: 404 })
    }
  }

  const location = await prisma.inventoryLocation.create({
    data: { companyId, name, parentId },
  })

  return NextResponse.json(location)
}