// The rules for saving appearance choices, shared by the two routes (a
// user's own preferences and the company defaults) and the Appearance
// screens. No React and no database imports.

import { isRowDensity, isSidebarStyle, isThemeHex, isThemeMode, type RowDensityChoice, type SidebarStyle, type ThemeModeChoice } from "@/lib/theme"

export const THEME_FIELDS = ["themeAccent", "themeSidebar", "themeMode"] as const

export interface ThemeFieldsPatch {
  themeAccent?: string | null
  themeSidebar?: SidebarStyle | null
  themeMode?: ThemeModeChoice | null
}

export interface PreferencesPatch extends ThemeFieldsPatch {
  rowDensity?: RowDensityChoice | null
}

export interface CompanyAppearancePatch extends ThemeFieldsPatch {
  allowUserTheme?: boolean
}

export const ACCENT_MESSAGE = "Accent color must be a hex color like #5E56E0"
export const SIDEBAR_MESSAGE = "Sidebar style must be DARK, LIGHT, or TINTED"
export const MODE_MESSAGE = "Mode must be LIGHT, DARK, or SYSTEM"
export const DENSITY_MESSAGE = "Row density must be COMPACT, DEFAULT, or COMFORTABLE"
export const ALLOW_MESSAGE = "Allow users to change their colors must be true or false"
export const THEME_LOCKED_MESSAGE = "Your company has turned off personal colors, so the company theme applies to everyone."
export const THEME_LOCKED_CODE = "THEME_LOCKED"

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

const isObject = (body: unknown): body is Record<string, unknown> => typeof body === "object" && body !== null && !Array.isArray(body)

// Each theme field left out is kept; null (or a blank accent) goes back to
// the default; anything else must be a valid value
function readThemeFields(body: Record<string, unknown>): Result<ThemeFieldsPatch> {
  const data: ThemeFieldsPatch = {}
  if ("themeAccent" in body) {
    const v = body.themeAccent
    if (v === null || v === "") data.themeAccent = null
    else if (isThemeHex(v)) data.themeAccent = v.toUpperCase()
    else return { error: ACCENT_MESSAGE }
  }
  if ("themeSidebar" in body) {
    const v = body.themeSidebar
    if (v === null) data.themeSidebar = null
    else if (isSidebarStyle(v)) data.themeSidebar = v
    else return { error: SIDEBAR_MESSAGE }
  }
  if ("themeMode" in body) {
    const v = body.themeMode
    if (v === null) data.themeMode = null
    else if (isThemeMode(v)) data.themeMode = v
    else return { error: MODE_MESSAGE }
  }
  return { data }
}

// PATCH /api/account/preferences
export function readPreferencesPatch(body: unknown): Result<PreferencesPatch> {
  if (!isObject(body)) return { error: "Invalid request" }
  const theme = readThemeFields(body)
  if (theme.error !== undefined) return theme
  const data: PreferencesPatch = { ...theme.data }
  if ("rowDensity" in body) {
    const v = body.rowDensity
    if (v === null) data.rowDensity = null
    else if (isRowDensity(v)) data.rowDensity = v
    else return { error: DENSITY_MESSAGE }
  }
  return { data }
}

// Whether a preferences change touches the colors (refused while the
// company has turned personal colors off; row density is always allowed)
export function changesThemeFields(patch: ThemeFieldsPatch): boolean {
  return THEME_FIELDS.some((key) => key in patch)
}

// PATCH /api/company-settings/appearance
export function readCompanyAppearancePatch(body: unknown): Result<CompanyAppearancePatch> {
  if (!isObject(body)) return { error: "Invalid request" }
  const theme = readThemeFields(body)
  if (theme.error !== undefined) return theme
  const data: CompanyAppearancePatch = { ...theme.data }
  if ("allowUserTheme" in body) {
    if (typeof body.allowUserTheme !== "boolean") return { error: ALLOW_MESSAGE }
    data.allowUserTheme = body.allowUserTheme
  }
  return { data }
}
