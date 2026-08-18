import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Walks up the tree from a candidate parent to make sure `targetId`
// (the category being moved) never appears among its own ancestors,
// which would create a loop.
async function wouldCreateCycle(companyId: string, targetId: string, candidateParentId: string): Promise<boolean> {
  let currentId: string | null = candidateParentId
  while (currentId) {
    if (currentId === targetId) return true
    const current: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: currentId, companyId },
      select: { parentId: true },
    })
    currentId = current?.parentId ?? null
  }
  return false
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId

  const existing = await prisma.category.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  const body = await req.json()
  const data: { name?: string; parentId?: string | null } = {}

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) {
      return NextResponse.json({ error: "Category name can't be blank" }, { status: 400 })
    }
    const duplicate = await prisma.category.findFirst({
      where: { companyId, name: { equals: name, mode: "insensitive" }, id: { not: id } },
    })
    if (duplicate) {
      return NextResponse.json({ error: "A category with this name already exists" }, { status: 409 })
    }
    data.name = name
  }

  if (body.parentId !== undefined) {
    const parentId = body.parentId || null
    if (parentId === id) {
      return NextResponse.json({ error: "A category can't be its own parent" }, { status: 400 })
    }
    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId, companyId } })
      if (!parent) {
        return NextResponse.json({ error: "Parent category not found" }, { status: 404 })
      }
      if (await wouldCreateCycle(companyId, id, parentId)) {
        return NextResponse.json({ error: "Can't move a category under one of its own subcategories" }, { status: 400 })
      }
    }
    data.parentId = parentId
  }

  const category = await prisma.category.update({ where: { id }, data })

  return NextResponse.json(category)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const companyId = session.user.companyId

  const existing = await prisma.category.findUnique({
    where: { id, companyId },
    include: {
      children: { select: { id: true } },
      catalogItems: { select: { id: true } },
    },
  })
  if (!existing) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }
  if (existing.children.length > 0) {
    return NextResponse.json(
      { error: "This category has subcategories under it. Delete or move those first." },
      { status: 409 }
    )
  }
  if (existing.catalogItems.length > 0) {
    return NextResponse.json(
      { error: `This category is in use by ${existing.catalogItems.length} catalog item(s). Reassign them first.` },
      { status: 409 }
    )
  }

  await prisma.category.delete({ where: { id } })

  return NextResponse.json({ success: true })
}