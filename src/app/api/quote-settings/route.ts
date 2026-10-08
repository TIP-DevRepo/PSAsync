import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { quoteSettingsSelect } from "@/lib/safe-selects"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: session.user.companyId },
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

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.quotes"))) {
    return NextResponse.json({ error: "You don't have permission to edit quote settings" }, { status: 403 })
  }

  const body = await req.json()

  // If a specific mailbox was chosen, make sure it actually belongs to
  // this company before saving it
  if (body.quoteSendFromMode === "SPECIFIC" && body.quoteSendFromConnectionId) {
    const connection = await prisma.microsoftConnection.findUnique({
      where: { id: body.quoteSendFromConnectionId, companyId: session.user.companyId },
    })
    if (!connection) {
      return NextResponse.json({ error: "That mailbox wasn't found" }, { status: 400 })
    }
  }

  const data = {
    quotePrefix: body.quotePrefix,
    quoteExpiryDays: Number(body.quoteExpiryDays),
    quoteTerms: body.quoteTerms || null,
    quoteDefaultCc: body.quoteDefaultCc || null,
    quoteApprovalThreshold: body.quoteApprovalThreshold ? Number(body.quoteApprovalThreshold) : null,
    quoteSendFromMode: body.quoteSendFromMode === "SPECIFIC" ? "SPECIFIC" : "CREATOR",
    quoteSendFromConnectionId: body.quoteSendFromMode === "SPECIFIC" ? body.quoteSendFromConnectionId || null : null,
  }

  const settings = await prisma.companySettings.upsert({
    where: { companyId: session.user.companyId },
    update: data,
    create: { companyId: session.user.companyId, ...data },
    select: quoteSettingsSelect,
  })

  return NextResponse.json(settings)
}