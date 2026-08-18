import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const contactTags = await prisma.contactTag.findMany({
    where: { companyId: session.user.companyId },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(contactTags)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()
  const name = (body.name ?? "").trim()

  if (!name) {
    return NextResponse.json({ error: "Tag name can't be blank" }, { status: 400 })
  }

  // Treat a duplicate name as a friendly no-op rather than a 500, same
  // approach as Industries — the picker flow can end up calling this with
  // a name that already exists.
  const existing = await prisma.contactTag.findFirst({
    where: { companyId: session.user.companyId, name },
  })
  if (existing) {
    return NextResponse.json(existing)
  }

  const contactTag = await prisma.contactTag.create({
    data: {
      companyId: session.user.companyId,
      name,
      color: body.color || null,
    },
  })

  return NextResponse.json(contactTag)
}