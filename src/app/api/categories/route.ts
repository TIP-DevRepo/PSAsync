import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const categories = await prisma.category.findMany({
    where: { companyId: session.user.companyId },
    select: { id: true, name: true, parentId: true, defaultIsSerialized: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(categories)
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
    return NextResponse.json({ error: "Category name is required" }, { status: 400 })
  }

  // Case-insensitive check since "Cables" and "cables" should count as
  // the same category, per the one-canonical-category-per-name rule.
  const existing = await prisma.category.findFirst({
    where: { companyId, name: { equals: name, mode: "insensitive" } },
  })
  if (existing) {
    return NextResponse.json({ error: "A category with this name already exists" }, { status: 409 })
  }

  if (parentId) {
    const parent = await prisma.category.findUnique({ where: { id: parentId, companyId } })
    if (!parent) {
      return NextResponse.json({ error: "Parent category not found" }, { status: 404 })
    }
  }

  const category = await prisma.category.create({
    data: { companyId, name, parentId },
  })

  return NextResponse.json(category)
}