import { NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

export async function POST() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  await prisma.notification.updateMany({
    where: { userId: ctx.userId, read: false },
    data: { read: true },
  })

  return NextResponse.json({ success: true })
}