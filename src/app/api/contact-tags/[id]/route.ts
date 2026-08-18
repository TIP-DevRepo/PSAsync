import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const existing = await prisma.contactTag.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: "Tag name can't be blank" }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.color !== undefined) data.color = body.color || null

  const contactTag = await prisma.contactTag.update({ where: { id }, data })

  return NextResponse.json(contactTag)
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

  const existing = await prisma.contactTag.findUnique({
    where: { id, companyId: session.user.companyId },
    select: { id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 })
  }

  // No manual cleanup needed here — ContactTagAssignment has onDelete:
  // Cascade on contactTagId, so deleting the tag automatically removes it
  // from every contact that had it, no orphaned rows left behind.
  await prisma.contactTag.delete({ where: { id } })

  return NextResponse.json({ success: true })
}