import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"
import { TENANT_GUID } from "@/lib/sso-tenant"

// Any active user, since the Microsoft panel works out whether a user can
// connect their own mailbox from these. The client secret itself is never
// returned, only whether one is saved.
export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
  })

  return NextResponse.json({
    microsoftClientId: settings?.microsoftClientId ?? "",
    microsoftTenantId: settings?.microsoftTenantId ?? "",
    hasClientSecret: !!settings?.microsoftClientSecret,
    ssoEnabled: settings?.ssoEnabled ?? false,
  })
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.integrations",
    message: "You do not have permission to configure Microsoft integration",
  })
  if (response) return response

  const body = await req.json()
  const companyId = ctx.companyId

  const current = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { microsoftClientId: true, microsoftTenantId: true, ssoEnabled: true },
  })

  // Only fields whose value actually changes are written. The panel always
  // sends the Client ID and Tenant ID back, so an unchanged resave must not
  // count as a change for the Global Admin rule below.
  const data: Record<string, unknown> = {}
  if (body.microsoftClientId !== undefined) {
    const value = body.microsoftClientId || null
    if (value !== (current?.microsoftClientId ?? null)) data.microsoftClientId = value
  }
  if (body.microsoftTenantId !== undefined) {
    const value = body.microsoftTenantId || null
    if (value !== (current?.microsoftTenantId ?? null)) data.microsoftTenantId = value
  }
  if (body.microsoftClientSecret) data.microsoftClientSecret = body.microsoftClientSecret
  if (body.ssoEnabled !== undefined && Boolean(body.ssoEnabled) !== (current?.ssoEnabled ?? false)) {
    data.ssoEnabled = Boolean(body.ssoEnabled)
  }

  // These fields decide which Microsoft directory can sign in as this
  // company's users, so changing any of them is Global Admin only
  if (Object.keys(data).length > 0) {
    if (!ctx.access.isGlobalAdmin) {
      return NextResponse.json(
        { error: "Only a Global Admin can change the Microsoft app credentials or Single Sign-On" },
        { status: 403 }
      )
    }
  }

  // A new tenant means a different directory of accounts, so SSO is turned
  // off in the same write and has to be deliberately turned back on
  const tenantChanged = "microsoftTenantId" in data
  const ssoDisabledByTenantChange = tenantChanged && (!!current?.ssoEnabled || data.ssoEnabled === true)
  if (tenantChanged) data.ssoEnabled = false

  if (data.ssoEnabled === true) {
    const tenantId = current?.microsoftTenantId ?? ""
    if (!TENANT_GUID.test(tenantId)) {
      return NextResponse.json(
        {
          error:
            "Single Sign-On needs the Directory (Tenant) ID saved as a GUID, like 00000000-0000-0000-0000-000000000000. Shared values such as common, organizations, or consumers can't be used.",
        },
        { status: 400 }
      )
    }
  }

  const settings = await prisma.companySettings.upsert({
    where: { companyId },
    update: data,
    create: { companyId, ...data },
    select: { microsoftClientId: true, microsoftTenantId: true, microsoftClientSecret: true, ssoEnabled: true },
  })

  return NextResponse.json({
    microsoftClientId: settings.microsoftClientId,
    microsoftTenantId: settings.microsoftTenantId,
    hasClientSecret: !!settings.microsoftClientSecret,
    ssoEnabled: settings.ssoEnabled,
    ssoDisabledByTenantChange,
  })
}