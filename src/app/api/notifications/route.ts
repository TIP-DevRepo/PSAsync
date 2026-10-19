import { NextResponse } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const notifications = await prisma.notification.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  })

  const unreadCount = await prisma.notification.count({
    where: { userId: ctx.userId, read: false },
  })

  return NextResponse.json({ notifications, unreadCount })
}