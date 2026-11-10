import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { userFacingError } from "@/lib/user-error"
import { layoutFromResolved, resolveSidebarLayout } from "@/lib/sidebar-layout"
import { parseStoredSidebarLayout, readCompanySidebarPatch } from "@/lib/sidebar-layout-schema"
import {
  allowsUserSidebar,
  COMPANY_SIDEBAR_SELECT,
  keepCompanyTeams,
  loadCompanyTeamsForSidebar,
  NO_SIDEBAR_LAYOUT,
  sidebarLayoutJson,
} from "@/lib/sidebar-preferences"

// The company's sidebar layout (Settings > Company Settings > Sidebar): the
// page and team order, which folders start open, the default views, and
// whether users may keep their own layout. Behind the same permission as
// the rest of Company Settings, and always the caller's own company.
// GET reads, PATCH saves (a part left out is kept), DELETE goes back to the
// PSAsync default layout (the switch is kept).

const RULE = { permission: "settingsSections.company", message: "You do not have permission to edit company settings" }

async function load(companyId: string) {
  const [settings, teams] = await Promise.all([
    prisma.companySettings.findUnique({ where: { companyId }, select: COMPANY_SIDEBAR_SELECT }),
    loadCompanyTeamsForSidebar(companyId),
  ])
  const layout = parseStoredSidebarLayout(settings?.sidebarLayout)
  return {
    // As stored, cleaned of unknown keys; null means the PSAsync default
    layout,
    allowUserSidebar: allowsUserSidebar(settings),
    // What everyone without their own layout sees, in full
    effective: layoutFromResolved(resolveSidebarLayout({ company: layout, user: null, allowUser: false })),
    // Every team of the company, for the folder order
    teams,
  }
}

export async function GET() {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response
  try {
    return NextResponse.json(await load(ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Loading the company sidebar")
    return apiError(status, message)
  }
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response

  const body = await req.json().catch(() => null)
  const patch = readCompanySidebarPatch(body)
  if (patch.error !== undefined) return apiError(400, patch.error)

  try {
    const data: { sidebarLayout?: ReturnType<typeof sidebarLayoutJson>; allowUserSidebar?: boolean } = {}
    if (patch.data.layout) data.sidebarLayout = sidebarLayoutJson(await keepCompanyTeams(ctx.companyId, patch.data.layout))
    if (patch.data.allowUserSidebar !== undefined) data.allowUserSidebar = patch.data.allowUserSidebar
    if (Object.keys(data).length > 0) {
      await prisma.companySettings.upsert({
        where: { companyId: ctx.companyId },
        update: data,
        create: { companyId: ctx.companyId, ...data },
      })
    }
    return NextResponse.json(await load(ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving the company sidebar")
    return apiError(status, message)
  }
}

// Reset to the PSAsync default layout
export async function DELETE() {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response
  try {
    await prisma.companySettings.updateMany({ where: { companyId: ctx.companyId }, data: { sidebarLayout: NO_SIDEBAR_LAYOUT } })
    return NextResponse.json(await load(ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Resetting the company sidebar")
    return apiError(status, message)
  }
}
