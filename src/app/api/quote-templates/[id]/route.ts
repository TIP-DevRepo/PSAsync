import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canSeeCost, notFound, omitCost, requireAccess } from "@/lib/api-access"
import { withSafeTerms } from "@/lib/sanitize-terms"
import { loadCompanyDefaultTerms, requestTouchesTerms, templateTermsView, termsPatchData } from "@/lib/quote-terms"

// Templates are maintained from Quote Settings
const TEMPLATE_WRITE_RULE = {
  settingsSection: "quotes",
  message: "You do not have permission to edit quote templates",
} as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess({
    // Quote Settings users maintain templates, so they read them too
    permission: ["pages.quotes", "settingsSections.quotes"],
    message: "You do not have permission to view quotes",
  })
  if (response) return response

  const { id } = await params

  const template = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: ctx.companyId },
    include: { lineItems: { include: { catalogItem: true } } },
  })

  if (!template) return notFound()

  // The terms to show come from the shared resolver; `terms` stays the
  // stored text for the editor
  const termsView = templateTermsView(template, await loadCompanyDefaultTerms(ctx.companyId))

  if (!canSeeCost(ctx)) {
    return NextResponse.json({
      ...withSafeTerms(template),
      ...termsView,
      lineItems: template.lineItems.map((li) => ({
        ...omitCost(li),
        catalogItem: li.catalogItem ? omitCost(li.catalogItem) : null,
      })),
    })
  }

  return NextResponse.json({ ...withSafeTerms(template), ...termsView })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess(TEMPLATE_WRITE_RULE)
  if (response) return response

  const { id } = await params
  const existing = await prisma.quoteTemplate.findUnique({
    where: { id, companyId: ctx.companyId },
  })
  if (!existing) return notFound()

  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description || null
  if (body.introText !== undefined) data.introText = body.introText || null
  // Same rules as a quote's terms; templates are never sent
  const companyDefault = await loadCompanyDefaultTerms(ctx.companyId)
  if (requestTouchesTerms(body)) Object.assign(data, termsPatchData(existing.useDefaultTerms, body, companyDefault))
  if (body.expiryDays !== undefined) data.expiryDays = Number(body.expiryDays) || 30
  if (body.active !== undefined) data.active = Boolean(body.active)

  const template = await prisma.quoteTemplate.update({ where: { id, companyId: ctx.companyId }, data })

  return NextResponse.json({ ...withSafeTerms(template), ...templateTermsView(template, companyDefault) })
}