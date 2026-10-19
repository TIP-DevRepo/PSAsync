import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { soPoSettingsSelect } from "@/lib/safe-selects"
import { apiError, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"
import { readSoStatusNotifyRules } from "@/lib/so-status-notify-rules"

// Only the Sales Order and Purchase Order settings panel reads or writes
// these. The order routes read the prefixes on the server themselves.
const SETTINGS_RULE = {
  permission: "settingsSections.salesOrders",
  message: "You do not have permission to manage sales order and purchase order settings",
}

export async function GET() {
  const { ctx, response } = await requireAccess(SETTINGS_RULE)
  if (response) return response

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
  })

  return NextResponse.json({
    soPrefix: settings?.soPrefix ?? "SO",
    poPrefix: settings?.poPrefix ?? "PO",
    poDefaultPaymentType: settings?.poDefaultPaymentType ?? "Net30",
    soStatusNotifyRules: settings?.soStatusNotifyRules ?? {},
  })
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess(SETTINGS_RULE)
  if (response) return response

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