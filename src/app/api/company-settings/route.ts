import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const company = await prisma.company.findUnique({
    where: { id: session.user.companyId },
    include: { settings: true },
  })

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  return NextResponse.json({
    name: company.name,
    logoUrl: company.logoUrl,
    secondaryLogoUrl: company.secondaryLogoUrl,
    primaryColor: company.settings?.primaryColor ?? "#1B3A5C",
    accentColor: company.settings?.accentColor ?? "#2E86AB",
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()
  const { name, primaryColor, accentColor } = body

  await prisma.company.update({
    where: { id: session.user.companyId },
    data: { name },
  })

  await prisma.companySettings.upsert({
    where: { companyId: session.user.companyId },
    update: { primaryColor, accentColor },
    create: {
      companyId: session.user.companyId,
      primaryColor,
      accentColor,
    },
  })

  return NextResponse.json({ success: true })
}