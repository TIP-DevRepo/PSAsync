import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { userFacingError } from "@/lib/user-error"
import { COMPANY_THEME_SELECT } from "@/lib/appearance"
import { readCompanyAppearancePatch } from "@/lib/appearance-rules"
import { allowsUserTheme, companyTheme } from "@/lib/theme"

// The company's appearance defaults (Settings > Company Settings >
// Appearance): accent, sidebar style, and mode for everyone who hasn't
// chosen their own, and whether users may choose. Behind the same
// permission as the rest of Company Info & Branding, and always the
// caller's own company.

const RULE = { permission: "settingsSections.company", message: "You do not have permission to edit company settings" }

async function load(companyId: string) {
  const settings = await prisma.companySettings.findUnique({ where: { companyId }, select: COMPANY_THEME_SELECT })
  return {
    // As stored: null means the PSAsync default
    themeAccent: settings?.themeAccent ?? null,
    themeSidebar: settings?.themeSidebar ?? null,
    themeMode: settings?.themeMode ?? null,
    allowUserTheme: allowsUserTheme(settings),
    // What everyone without their own choice sees
    theme: companyTheme(settings),
  }
}

export async function GET() {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response
  try {
    return NextResponse.json(await load(ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Loading company appearance")
    return apiError(status, message)
  }
}

export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAccess(RULE)
  if (response) return response

  const body = await req.json().catch(() => null)
  const patch = readCompanyAppearancePatch(body)
  if (patch.error !== undefined) return apiError(400, patch.error)

  try {
    if (Object.keys(patch.data).length > 0) {
      await prisma.companySettings.upsert({
        where: { companyId: ctx.companyId },
        update: patch.data,
        create: { companyId: ctx.companyId, ...patch.data },
      })
    }
    return NextResponse.json(await load(ctx.companyId))
  } catch (err) {
    const { message, status } = userFacingError(err, "Saving company appearance")
    return apiError(status, message)
  }
}
