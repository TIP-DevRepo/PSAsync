import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { soPoSettingsSelect } from "@/lib/safe-selects"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: session.user.companyId },
  })

  return NextResponse.json({
    soPrefix: settings?.soPrefix ?? "SO",
    poPrefix: settings?.poPrefix ?? "PO",
    poDefaultPaymentType: settings?.poDefaultPaymentType ?? "Net30",
    soStatusNotifyRules: settings?.soStatusNotifyRules ?? {},
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.salesOrders"))) {
    return NextResponse.json({ error: "You don't have permission to edit these settings" }, { status: 403 })
  }

  const body = await req.json()
  const companyId = session.user.companyId

  const data: Record<string, unknown> = {}
  if (body.soPrefix !== undefined) data.soPrefix = body.soPrefix
  if (body.poPrefix !== undefined) data.poPrefix = body.poPrefix
  if (body.poDefaultPaymentType !== undefined) data.poDefaultPaymentType = body.poDefaultPaymentType
  if (body.soStatusNotifyRules !== undefined) data.soStatusNotifyRules = body.soStatusNotifyRules

  const settings = await prisma.companySettings.upsert({
    where: { companyId },
    update: data,
    create: { companyId, ...data },
    select: soPoSettingsSelect,
  })

  return NextResponse.json(settings)
}