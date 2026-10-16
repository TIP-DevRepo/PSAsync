import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

// Any active user, for their own preferred distributor list
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { preferredDistributors: true },
  })

  return NextResponse.json({ distributors: user?.preferredDistributors ?? [] })
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const body = await req.json()
  const distributors: string[] = Array.isArray(body.distributors) ? body.distributors : []

  await prisma.user.update({
    where: { id: ctx.userId },
    data: { preferredDistributors: distributors },
  })

  return NextResponse.json({ distributors })
}
