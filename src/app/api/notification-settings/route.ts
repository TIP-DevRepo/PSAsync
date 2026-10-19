import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { notificationSettingsSelect } from "@/lib/safe-selects"

// Only the Notifications settings panel reads or writes these
const SETTINGS_RULE = {
  permission: "settingsSections.notifications",
  message: "You do not have permission to manage notification settings",
}

export async function GET() {
  const { ctx, response } = await requireAccess(SETTINGS_RULE)
  if (response) return response

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
  })

  return NextResponse.json({
    emailDefaultCc: settings?.emailDefaultCc ?? "",
    emailSignature: settings?.emailSignature ?? "",
  })
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess(SETTINGS_RULE)
  if (response) return response

  const body = await req.json()

  const settings = await prisma.companySettings.upsert({
    where: { companyId: ctx.companyId },
    update: {
      emailDefaultCc: body.emailDefaultCc || null,
      emailSignature: body.emailSignature || null,
    },
    create: {
      companyId: ctx.companyId,
      emailDefaultCc: body.emailDefaultCc || null,
      emailSignature: body.emailSignature || null,
    },
    select: notificationSettingsSelect,
  })

  return NextResponse.json(settings)
}
