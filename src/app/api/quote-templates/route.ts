import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canSeeCost, omitCost, requireAccess } from "@/lib/api-access"
import { termsForStorage, withSafeTerms } from "@/lib/sanitize-terms"

// Templates are maintained from Quote Settings
const TEMPLATE_WRITE_RULE = {
  settingsSection: "quotes",
  message: "You do not have permission to edit quote templates",
} as const

export async function GET() {
  const { ctx, response } = await requireAccess({ page: "quotes", message: "You do not have permission to view quotes" })
  if (response) return response

  const templates = await prisma.quoteTemplate.findMany({
    where: { companyId: ctx.companyId },
    include: { lineItems: true },
    orderBy: { name: "asc" },
  })

  if (!canSeeCost(ctx)) {
    return NextResponse.json(templates.map((t) => ({ ...withSafeTerms(t), lineItems: t.lineItems.map(omitCost) })))
  }

  return NextResponse.json(templates.map(withSafeTerms))
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const body = await req.json()

  const template = await prisma.quoteTemplate.create({
    data: {
      companyId: ctx.companyId,
      name: body.name,
      description: body.description || null,
      introText: body.introText || null,
      terms: termsForStorage(body.terms),
      expiryDays: Number(body.expiryDays) || 30,
      active: body.active ?? true,
    },
  })

  return NextResponse.json(withSafeTerms(template))
}