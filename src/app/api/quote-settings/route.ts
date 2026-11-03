import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { quoteSettingsSelect } from "@/lib/safe-selects"
import { apiError, requireAccess } from "@/lib/api-access"
import { termsForStorage, termsToDisplayHtml } from "@/lib/sanitize-terms"
import { numberPrefixProblem } from "@/lib/number-prefix"
import { EXPIRY_DAYS_MESSAGE, isValidExpiryDays } from "@/lib/quote-expiry"

// Any active user, since the quote pages read these defaults
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
    include: { quoteSendFromConnection: { select: { id: true, label: true, email: true } } },
  })

  return NextResponse.json({
    quotePrefix: settings?.quotePrefix ?? "Q",
    quoteExpiryDays: settings?.quoteExpiryDays ?? 30,
    quoteTerms: termsToDisplayHtml(settings?.quoteTerms) ?? "",
    quoteDefaultCc: settings?.quoteDefaultCc ?? "",
    quoteApprovalThreshold: settings?.quoteApprovalThreshold ?? null,
    quoteSendFromMode: settings?.quoteSendFromMode ?? "CREATOR",
    quoteSendFromConnectionId: settings?.quoteSendFromConnectionId ?? null,
    quoteSendFromConnection: settings?.quoteSendFromConnection ?? null,
  })
}

// A number field from the request body: undefined when it was left out or
// blank (so the stored value is kept), NaN when it isn't a number
function readNumberField(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined
  return typeof value === "number" || typeof value === "string" ? Number(value) : NaN
}

// The Default Expiry days, or null when the value can't be saved
function readExpiryDays(value: unknown): number | null {
  const days = readNumberField(value)
  return days !== undefined && isValidExpiryDays(days) ? days : null
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.quotes",
    message: "You do not have permission to edit quote settings",
  })
  if (response) return response

  const body = await req.json()

  // Left out keeps the stored value. Anything sent must be a whole number of
  // days, 1 or more: a blank field is refused rather than saved as 0, and 0
  // never meant "no expiry" (new quotes fell back to 30 days).
  const quoteExpiryDays = body.quoteExpiryDays === undefined ? undefined : readExpiryDays(body.quoteExpiryDays)
  if (quoteExpiryDays === null) {
    return apiError(400, EXPIRY_DAYS_MESSAGE)
  }
  const approvalThreshold = body.quoteApprovalThreshold ? readNumberField(body.quoteApprovalThreshold) : undefined
  if (approvalThreshold !== undefined && !Number.isFinite(approvalThreshold)) {
    return apiError(400, "Approval threshold must be a number")
  }

  // The prefix becomes part of every quote number and PDF name. Checked
  // only when it changes, so a company whose stored prefix predates the
  // rule can still save its other settings.
  if (body.quotePrefix !== undefined) {
    const stored = await prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { quotePrefix: true } })
    if (body.quotePrefix !== (stored?.quotePrefix ?? "Q")) {
      const problem = numberPrefixProblem(body.quotePrefix, "Quote number")
      if (problem) return apiError(400, problem)
    }
  }

  // If a specific mailbox was chosen, make sure it actually belongs to
  // this company before saving it
  if (body.quoteSendFromMode === "SPECIFIC" && body.quoteSendFromConnectionId) {
    const connection = await prisma.microsoftConnection.findUnique({
      where: { id: body.quoteSendFromConnectionId, companyId: ctx.companyId },
    })
    if (!connection) {
      return NextResponse.json({ error: "That mailbox wasn't found" }, { status: 400 })
    }
  }

  const data = {
    quotePrefix: body.quotePrefix,
    quoteExpiryDays,
    quoteTerms: termsForStorage(body.quoteTerms),
    quoteDefaultCc: body.quoteDefaultCc || null,
    quoteApprovalThreshold: approvalThreshold ?? null,
    quoteSendFromMode: body.quoteSendFromMode === "SPECIFIC" ? "SPECIFIC" : "CREATOR",
    quoteSendFromConnectionId: body.quoteSendFromMode === "SPECIFIC" ? body.quoteSendFromConnectionId || null : null,
  }

  const settings = await prisma.companySettings.upsert({
    where: { companyId: ctx.companyId },
    update: data,
    create: { companyId: ctx.companyId, ...data },
    select: quoteSettingsSelect,
  })

  return NextResponse.json({ ...settings, quoteTerms: termsToDisplayHtml(settings.quoteTerms) })
}