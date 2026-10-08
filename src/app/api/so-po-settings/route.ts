import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { soPoSettingsSelect } from "@/lib/safe-selects"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { readSoStatusNotifyRules } from "@/lib/so-status-notify-rules"

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
  const { ctx, response } = await requireAccess()
  if (response) return response
  if (!ctx.can("settingsSections.salesOrders")) {
    return NextResponse.json({ error: "You don't have permission to edit these settings" }, { status: 403 })
  }

  const body = await req.json()
  const companyId = ctx.companyId

  const data: Record<string, unknown> = {}
  if (body.soPrefix !== undefined) data.soPrefix = body.soPrefix
  if (body.poPrefix !== undefined) data.poPrefix = body.poPrefix
  if (body.poDefaultPaymentType !== undefined) data.poDefaultPaymentType = body.poDefaultPaymentType
  if (body.soStatusNotifyRules !== undefined) {
    const read = readSoStatusNotifyRules(body.soStatusNotifyRules)
    if (!read) {
      return apiError(400, "Invalid notification rules")
    }
    // A rule saved earlier may point at someone deactivated since, and the
    // panel sends every rule on each save, so users only need to be in the
    // company here
    const invalid = await assertRefs(ctx, { companyUserId: read.userIds, roleId: read.roleIds })
    if (invalid) return invalid
    data.soStatusNotifyRules = read.rules
  }

  const settings = await prisma.companySettings.upsert({
    where: { companyId },
    update: data,
    create: { companyId, ...data },
    select: soPoSettingsSelect,
  })

  return NextResponse.json(settings)
}