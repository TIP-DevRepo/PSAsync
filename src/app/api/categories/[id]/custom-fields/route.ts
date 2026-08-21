import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Walks upward from a category to the root, collecting every ancestor's id.
async function getAncestorIds(companyId: string, categoryId: string): Promise<string[]> {
  const ids: string[] = []
  let current = await prisma.category.findUnique({ where: { id: categoryId, companyId }, select: { parentId: true } })
  while (current?.parentId) {
    ids.push(current.parentId)
    current = await prisma.category.findUnique({ where: { id: current.parentId, companyId }, select: { parentId: true } })
  }
  return ids
}

// Walks downward from a category, collecting every descendant's id at any depth.
async function getDescendantIds(companyId: string, categoryId: string): Promise<string[]> {
  const ids: string[] = []
  let queue = [categoryId]
  while (queue.length > 0) {
    const children = await prisma.category.findMany({ where: { parentId: { in: queue }, companyId }, select: { id: true } })
    const childIds = children.map((c) => c.id)
    ids.push(...childIds)
    queue = childIds
  }
  return ids
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id: categoryId } = await params

  const fields = await prisma.inventoryCustomField.findMany({
    where: { categoryId, companyId: session.user.companyId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(fields)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id: categoryId } = await params
  const companyId = session.user.companyId
  const body = await req.json()
  const name = (body.name ?? "").trim()

  if (!name) {
    return NextResponse.json({ error: "Field name is required" }, { status: 400 })
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId, companyId } })
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }

  // A category's fields display alongside every ancestor's fields (a
  // "Laptop" asset shows both Laptop's and its parent "Serialized"
  // category's fields), so a duplicate name anywhere in that chain,
  // above or below, would show up twice on the same asset.
  const ancestorIds = await getAncestorIds(companyId, categoryId)
  const descendantIds = await getDescendantIds(companyId, categoryId)
  const relatedIds = [categoryId, ...ancestorIds, ...descendantIds]

  const duplicate = await prisma.inventoryCustomField.findFirst({
    where: { categoryId: { in: relatedIds }, name: { equals: name, mode: "insensitive" } },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: "A field with this name already exists on this category or one of its parent/child categories" },
      { status: 409 }
    )
  }

  const highestOrder = await prisma.inventoryCustomField.findFirst({
    where: { categoryId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  const field = await prisma.inventoryCustomField.create({
    data: {
      companyId,
      categoryId,
      name,
      sortOrder: (highestOrder?.sortOrder ?? -1) + 1,
    },
  })

  return NextResponse.json(field)
}