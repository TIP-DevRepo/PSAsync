import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function getAncestorIds(companyId: string, categoryId: string): Promise<string[]> {
  const ids: string[] = []
  let current = await prisma.category.findUnique({ where: { id: categoryId, companyId }, select: { parentId: true } })
  while (current?.parentId) {
    ids.push(current.parentId)
    current = await prisma.category.findUnique({ where: { id: current.parentId, companyId }, select: { parentId: true } })
  }
  return ids
}

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

  const existing = await prisma.inventoryCustomField.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Field not found" }, { status: 404 })
  }

  const body = await req.json()

  if (body.name === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const name = body.name.trim()
  if (!name) {
    return NextResponse.json({ error: "Field name can't be blank" }, { status: 400 })
  }

  const ancestorIds = await getAncestorIds(companyId, existing.categoryId)
  const descendantIds = await getDescendantIds(companyId, existing.categoryId)
  const relatedIds = [existing.categoryId, ...ancestorIds, ...descendantIds]

  const duplicate = await prisma.inventoryCustomField.findFirst({
    where: { categoryId: { in: relatedIds }, name: { equals: name, mode: "insensitive" }, id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: "A field with this name already exists on this category or one of its parent/child categories" },
      { status: 409 }
    )
  }

  const field = await prisma.inventoryCustomField.update({ where: { id }, data: { name } })

  return NextResponse.json(field)
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

  const existing = await prisma.inventoryCustomField.findUnique({ where: { id, companyId } })
  if (!existing) {
    return NextResponse.json({ error: "Field not found" }, { status: 404 })
  }

  // No "in use" guard needed yet, InventoryCustomFieldValue doesn't exist
  // until Phase 5, so there's nothing that could reference this field yet.
  await prisma.inventoryCustomField.delete({ where: { id } })

  return NextResponse.json({ success: true })
}