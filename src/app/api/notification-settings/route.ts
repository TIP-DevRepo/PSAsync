import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { notificationSettingsSelect } from "@/lib/safe-selects"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: session.user.companyId },
  })

  return NextResponse.json({
    emailDefaultCc: settings?.emailDefaultCc ?? "",
    emailSignature: settings?.emailSignature ?? "",
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.notifications"))) {
    return NextResponse.json({ error: "You don't have permission to edit notification settings" }, { status: 403 })
  }

  const body = await req.json()

  const settings = await prisma.companySettings.upsert({
    where: { companyId: session.user.companyId },
    update: {
      emailDefaultCc: body.emailDefaultCc || null,
      emailSignature: body.emailSignature || null,
    },
    create: {
      companyId: session.user.companyId,
      emailDefaultCc: body.emailDefaultCc || null,
      emailSignature: body.emailSignature || null,
    },
    select: notificationSettingsSelect,
  })

  return NextResponse.json(settings)
}