import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { preferredDistributors: true },
  })

  return NextResponse.json({ distributors: user?.preferredDistributors ?? [] })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()
  const distributors: string[] = Array.isArray(body.distributors) ? body.distributors : []

  await prisma.user.update({
    where: { id: session.user.id },
    data: { preferredDistributors: distributors },
  })

  return NextResponse.json({ distributors })
}