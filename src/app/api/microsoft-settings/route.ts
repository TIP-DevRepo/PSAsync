import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission, getEffectiveAccess } from "@/lib/permissions"

// A specific Entra directory id. The shared endpoints (common,
// organizations, consumers) would accept accounts from any directory.
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const settings = await prisma.companySettings.findUnique({
    where: { companyId: session.user.companyId },
  })

  return NextResponse.json({
    microsoftClientId: settings?.microsoftClientId ?? "",
    microsoftTenantId: settings?.microsoftTenantId ?? "",
    hasClientSecret: !!settings?.microsoftClientSecret,
    ssoEnabled: settings?.ssoEnabled ?? false,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!(await hasPermission(session.user.id, "settingsSections.integrations"))) {
    return NextResponse.json({ error: "You don't have permission to configure Microsoft integration" }, { status: 403 })
  }

  const body = await req.json()
  const companyId = session.user.companyId

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
    const access = await getEffectiveAccess(session.user.id)
    if (!access?.isGlobalAdmin) {
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