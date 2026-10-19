import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { quoteSettingsSelect } from "@/lib/safe-selects"
import { apiError, requireAccess } from "@/lib/api-access"

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
    quoteTerms: settings?.quoteTerms ?? "",
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

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.quotes",
    message: "You do not have permission to edit quote settings",
  })
  if (response) return response

  const body = await req.json()

  // Never written as NaN: left out keeps the stored value, anything that
  // isn't a whole number is refused
  const quoteExpiryDays = readNumberField(body.quoteExpiryDays)
  if (quoteExpiryDays !== undefined && !Number.isInteger(quoteExpiryDays)) {
    return apiError(400, "Quote expiry days must be a whole number")
  }
  const approvalThreshold = body.quoteApprovalThreshold ? readNumberField(body.quoteApprovalThreshold) : undefined
  if (approvalThreshold !== undefined && !Number.isFinite(approvalThreshold)) {
    return apiError(400, "Approval threshold must be a number")
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
    quoteTerms: body.quoteTerms || null,
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

  return NextResponse.json(settings)
}