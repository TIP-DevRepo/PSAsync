// Server side only (it reads the database)
import { cache } from "react"
import { prisma } from "@/lib/prisma"
import {
  allowsUserTheme,
  companyTheme,
  DEFAULT_DENSITY,
  isRowDensity,
  resolveTheme,
  type CompanyThemeInput,
  type ResolvedTheme,
  type RowDensityChoice,
  type UserThemeInput,
} from "@/lib/theme"

// What the app shell needs about the signed in user's look, read once per
// request (React cache): the root layout writes the theme into the page,
// and the dashboard layout reads the company's name and logo and the
// user's row density from the same lookup.
export interface AppearanceContext {
  theme: ResolvedTheme
  companyTheme: ResolvedTheme
  allowUserTheme: boolean
  rowDensity: RowDensityChoice
  companyName: string
  logoUrl: string | null
}

export const COMPANY_THEME_SELECT = { themeAccent: true, themeSidebar: true, themeMode: true, allowUserTheme: true } as const
export const USER_PREFERENCES_SELECT = { themeAccent: true, themeSidebar: true, themeMode: true, rowDensity: true } as const

export const loadAppearance = cache(async (userId: string): Promise<AppearanceContext | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      preferences: { select: USER_PREFERENCES_SELECT },
      company: { select: { name: true, logoUrl: true, settings: { select: COMPANY_THEME_SELECT } } },
    },
  })
  if (!user) return null
  const company: CompanyThemeInput | null = user.company.settings
  const prefs: UserThemeInput | null = user.preferences
  return {
    theme: resolveTheme(company, prefs),
    companyTheme: companyTheme(company),
    allowUserTheme: allowsUserTheme(company),
    // Row density is the user's own whatever the color setting
    rowDensity: isRowDensity(user.preferences?.rowDensity) ? user.preferences.rowDensity : DEFAULT_DENSITY,
    companyName: user.company.name,
    logoUrl: safeLogoUrl(user.company.logoUrl),
  }
})

// Only an https link reaches the sidebar's img tag
function safeLogoUrl(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null
}
