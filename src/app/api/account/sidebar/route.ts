import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { userFacingError } from "@/lib/user-error"
import { layoutFromResolved, resolveSidebarLayout, SIDEBAR_LOCKED_CODE, SIDEBAR_LOCKED_MESSAGE } from "@/lib/sidebar-layout"
import { parseStoredSidebarLayout, readUserSidebarPatch } from "@/lib/sidebar-layout-schema"
import { allowsUserSidebar, COMPANY_SIDEBAR_SELECT, keepCompanyTeams, NO_SIDEBAR_LAYOUT, sidebarLayoutJson } from "@/lib/sidebar-preferences"

// The signed in user's own sidebar layout (My settings > Sidebar). Any
// active user, and only ever their own row: the user is the session's,
// never an id from the request. GET reads it with the company's layout
// (what Reset goes back to) and the one in use; PATCH saves the whole
// layout, refused with 403 SIDEBAR_LOCKED while the company has turned
// personal layouts off; DELETE goes back to the company layout, always
// allowed.

async function load(userId: string, companyId: string) {
  const [prefs, settings] = await Promise.all([
    prisma.userPreferences.findUnique({ where: { userId }, select: { sidebarLayout: true } }),
    prisma.companySettings.findUnique({ where: { companyId }, select: COMPANY_SIDEBAR_SELECT }),
  ])
  const layout = parseStoredSidebarLayout(prefs?.sidebarLayout)
  const companyLayout = parseStoredSidebarLayout(settings?.sidebarLayout)
  const allowUser = allowsUserSidebar(settings)
  return {
    // As stored, cleaned of unknown keys; null means the company layout
    layout,
    allowUserSidebar: allowUser,
    company: layoutFromResolved(resolveSidebarLayout({ company: companyLayout, user: null, allowUser: false })),
    // What this user sees now
    effective: layoutFromResolved(resolveSidebarLayout({ company: companyLayout, user: layout, allowUser })),
  }
}

export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response
  try {
    return NextResponse.json(await load(ctx.userId, ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Loading the sidebar layout")
    return apiError(status, message)
  }
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const body = await req.json().catch(() => null)
  const patch = readUserSidebarPatch(body)
  if (patch.error !== undefined) return apiError(400, patch.error)

  try {
    const settings = await prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { allowUserSidebar: true } })
    if (!allowsUserSidebar(settings)) return apiError(403, SIDEBAR_LOCKED_MESSAGE, SIDEBAR_LOCKED_CODE)
    const sidebarLayout = sidebarLayoutJson(await keepCompanyTeams(ctx.companyId, patch.data.layout))
    await prisma.userPreferences.upsert({
      where: { userId: ctx.userId },
      update: { sidebarLayout },
      create: { userId: ctx.userId, sidebarLayout },
    })
    return NextResponse.json(await load(ctx.userId, ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving the sidebar layout")
    return apiError(status, message)
  }
}

// Reset to the company layout
export async function DELETE() {
  const { ctx, response } = await requireAccess()
  if (response) return response
  try {
    await prisma.userPreferences.updateMany({ where: { userId: ctx.userId }, data: { sidebarLayout: NO_SIDEBAR_LAYOUT } })
    return NextResponse.json(await load(ctx.userId, ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Resetting the sidebar layout")
    return apiError(status, message)
  }
}
