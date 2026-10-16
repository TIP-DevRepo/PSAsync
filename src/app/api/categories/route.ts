import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

// Open to any active user: catalog and inventory forms pick categories
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const categories = await prisma.category.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, name: true, parentId: true, defaultIsSerialized: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(categories)
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    settingsSection: "company",
    message: "You do not have permission to manage company settings",
  })
  if (response) return response

  const companyId = ctx.companyId
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