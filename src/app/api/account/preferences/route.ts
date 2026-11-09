import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { userFacingError } from "@/lib/user-error"
import { COMPANY_THEME_SELECT, USER_PREFERENCES_SELECT } from "@/lib/appearance"
import { changesThemeFields, readPreferencesPatch, THEME_LOCKED_CODE, THEME_LOCKED_MESSAGE } from "@/lib/appearance-rules"
import { allowsUserTheme, companyTheme, resolveTheme } from "@/lib/theme"

// The signed in user's own appearance preferences (My settings >
// Appearance). Any active user, and only ever their own row: the user is
// the session's, never an id from the request. Null fields mean the company
// default. The company's theme defaults come back too, so the page can show
// what Reset goes back to; they hold nothing private.

async function load(userId: string, companyId: string) {
  const [prefs, company] = await Promise.all([
    prisma.userPreferences.findUnique({ where: { userId }, select: USER_PREFERENCES_SELECT }),
    prisma.companySettings.findUnique({ where: { companyId }, select: COMPANY_THEME_SELECT }),
  ])
  return {
    preferences: {
      themeAccent: prefs?.themeAccent ?? null,
      themeSidebar: prefs?.themeSidebar ?? null,
      themeMode: prefs?.themeMode ?? null,
      rowDensity: prefs?.rowDensity ?? null,
    },
    company: { ...companyTheme(company), allowUserTheme: allowsUserTheme(company) },
    // What this user sees now
    theme: resolveTheme(company, prefs),
  }
}

export async function GET() {
  const { ctx, response } = await requireAccess()
  if (response) return response
  try {
    return NextResponse.json(await load(ctx.userId, ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Loading appearance preferences")
    return apiError(status, message)
  }
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess()
  if (response) return response

  const body = await req.json().catch(() => null)
  const patch = readPreferencesPatch(body)
  if (patch.error !== undefined) return apiError(400, patch.error)

  try {
    // Colors follow the company theme while personal colors are off; row
    // density is the user's own either way
    if (changesThemeFields(patch.data)) {
      const company = await prisma.companySettings.findUnique({ where: { companyId: ctx.companyId }, select: { allowUserTheme: true } })
      if (!allowsUserTheme(company)) return apiError(403, THEME_LOCKED_MESSAGE, THEME_LOCKED_CODE)
    }
    if (Object.keys(patch.data).length > 0) {
      await prisma.userPreferences.upsert({
        where: { userId: ctx.userId },
        update: patch.data,
        create: { userId: ctx.userId, ...patch.data },
      })
    }
    return NextResponse.json(await load(ctx.userId, ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving appearance preferences")
    return apiError(status, message)
  }
}
