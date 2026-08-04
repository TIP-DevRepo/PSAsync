import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params

  const comments = await prisma.sOComment.findMany({
    where: { salesOrderId: id },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(comments)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: "A message is required" }, { status: 400 })
  }

  const comment = await prisma.sOComment.create({
    data: {
      salesOrderId: id,
      authorUserId: session.user.id,
      authorName: session.user.name ?? "Unknown",
      message: body.message.trim(),
    },
  })

  return NextResponse.json(comment)
}