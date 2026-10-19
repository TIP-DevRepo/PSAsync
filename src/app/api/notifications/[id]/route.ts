import { NextRequest, NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  // Confirm this notification belongs to the requesting user before touching it
  const existing = await prisma.notification.findUnique({ where: { id } })
  if (!existing || existing.userId !== ctx.userId) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 })
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const { id } = await params

  const existing = await prisma.notification.findUnique({ where: { id } })
  if (!existing || existing.userId !== ctx.userId) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 })
  }

  await prisma.notification.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}