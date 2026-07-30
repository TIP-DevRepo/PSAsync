import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const clients = await prisma.client.findMany({
    where: { companyId: session.user.companyId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      industryRef: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(clients)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()

  const client = await prisma.client.create({
    data: {
      companyId: session.user.companyId,
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      website: body.website || null,
      industryId: body.industryId || null,
      status: body.status || "PROSPECT",
      notes: body.notes || null,
    },
  })

  return NextResponse.json(client)
}