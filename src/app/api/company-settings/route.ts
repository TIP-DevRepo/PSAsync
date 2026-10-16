import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { isHexColor } from "@/lib/html"

// Any active user: the name, logos, and brand colors
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const company = await prisma.company.findUnique({
    where: { id: ctx.companyId },
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
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.company",
    message: "You do not have permission to edit company settings",
  })
  if (response) return response

  const body = await req.json()
  const { name, primaryColor, accentColor } = body

  // Brand colors end up in CSS (the app theme, the portal, quote PDFs), so
  // only plain hex colors are stored
  if (primaryColor !== undefined && !isHexColor(primaryColor)) {
    return NextResponse.json({ error: "Primary color must be a hex color like #1B3A5C" }, { status: 400 })
  }
  if (accentColor !== undefined && !isHexColor(accentColor)) {
    return NextResponse.json({ error: "Accent color must be a hex color like #2E86AB" }, { status: 400 })
  }

  await prisma.company.update({
    where: { id: ctx.companyId },
    data: { name },
  })

  await prisma.companySettings.upsert({
    where: { companyId: ctx.companyId },
    update: { primaryColor, accentColor },
    create: {
      companyId: ctx.companyId,
      primaryColor,
      accentColor,
    },
  })

  return NextResponse.json({ success: true })
}
