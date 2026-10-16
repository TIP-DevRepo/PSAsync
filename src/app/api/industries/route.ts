import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

// Open to any active user: the client forms pick industries
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const industries = await prisma.industry.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(industries)
}

// Also allowed from the client forms, which add an industry inline
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: ["settingsSections.company", "clients.create", "clients.edit"],
    message: "You do not have permission to add industries",
  })
  if (response) return response

  const body = await req.json()
  const name = (body.name ?? "").trim()

  if (!name) {
    return NextResponse.json({ error: "Industry name can't be blank" }, { status: 400 })
  }

  // Treat a duplicate name (case-sensitive match on the unique constraint)
  // as a friendly no-op rather than a 500 — the combobox flow especially
  // can end up calling this with a name that already exists.
  const existing = await prisma.industry.findFirst({
    where: { companyId: ctx.companyId, name },
  })
  if (existing) {
    return NextResponse.json(existing)
  }

  const industry = await prisma.industry.create({
    data: { companyId: ctx.companyId, name },
  })

  return NextResponse.json(industry)
}