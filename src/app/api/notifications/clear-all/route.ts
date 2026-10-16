import { NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

export async function POST() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  await prisma.notification.deleteMany({ where: { userId: ctx.userId } })

  return NextResponse.json({ success: true })
}