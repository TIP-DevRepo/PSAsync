import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const industries = await prisma.industry.findMany({
    where: { companyId: session.user.companyId },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(industries)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()
  const name = (body.name ?? "").trim()

  if (!name) {
    return NextResponse.json({ error: "Industry name can't be blank" }, { status: 400 })
  }

  // Treat a duplicate name (case-sensitive match on the unique constraint)
  // as a friendly no-op rather than a 500 — the combobox flow especially
  // can end up calling this with a name that already exists.
  const existing = await prisma.industry.findFirst({
    where: { companyId: session.user.companyId, name },
  })
  if (existing) {
    return NextResponse.json(existing)
  }

  const industry = await prisma.industry.create({
    data: { companyId: session.user.companyId, name },
  })

  return NextResponse.json(industry)
}