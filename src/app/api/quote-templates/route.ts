import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canSeeCost, omitCost, requireAccess } from "@/lib/api-access"
import { termsForStorage, withSafeTerms } from "@/lib/sanitize-terms"
import { loadCompanyDefaultTerms, templateTermsView } from "@/lib/quote-terms"

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

  // Templates are never sent, so they follow the company default whenever
  // their flag is ticked (src/lib/quote-terms.ts)
  const companyDefault = await loadCompanyDefaultTerms(ctx.companyId)
  const withTerms = <T extends { terms: string | null; useDefaultTerms: boolean }>(t: T) => ({
    ...withSafeTerms(t),
    ...templateTermsView(t, companyDefault),
  })

  if (!canSeeCost(ctx)) {
    return NextResponse.json(templates.map((t) => ({ ...withTerms(t), lineItems: t.lineItems.map(omitCost) })))
  }

  return NextResponse.json(templates.map(withTerms))
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const body = await req.json()

  // The default terms flag: as the request sets it, else unticked when the
  // request brings its own terms. Ticked stores a copy of the default.
  const companyDefault = await loadCompanyDefaultTerms(ctx.companyId)
  const useDefaultTerms =
    typeof body.useDefaultTerms === "boolean" ? body.useDefaultTerms : !termsForStorage(body.terms)

  const template = await prisma.quoteTemplate.create({
    data: {
      companyId: ctx.companyId,
      name: body.name,
      description: body.description || null,
      introText: body.introText || null,
      terms: useDefaultTerms ? termsForStorage(companyDefault) : termsForStorage(body.terms),
      useDefaultTerms,
      expiryDays: Number(body.expiryDays) || 30,
      active: body.active ?? true,
    },
  })

  return NextResponse.json({ ...withSafeTerms(template), ...templateTermsView(template, companyDefault) })
}