// The app's color theme, shared by the server (the root layout writes it
// into the page before anything paints) and the browser (the Appearance
// settings preview it live). No React and no database imports.
//
// The color math is ported from the approved mockup
// (docs/design/ui-refresh-mockup.html, its theme() function) with the same
// numbers. mockupTheme() is that port exactly; buildTheme() starts from it
// and only nudges a color where the mockup's value would leave text under
// 4.5 to 1 (WCAG AA), so most presets come out exactly as drawn. See
// PSAsync-Design-Rules.md for the variables and what each one is for.

import { contrastRatio } from "@/lib/timeline-buttons"

// ─── Choices ────────────────────────────────────────────────────────────────

export type SidebarStyle = "DARK" | "LIGHT" | "TINTED"
export type ThemeModeChoice = "LIGHT" | "DARK" | "SYSTEM"
export type RowDensityChoice = "COMPACT" | "DEFAULT" | "COMFORTABLE"

export const SIDEBAR_STYLES: readonly SidebarStyle[] = ["DARK", "LIGHT", "TINTED"]
export const THEME_MODES: readonly ThemeModeChoice[] = ["LIGHT", "DARK", "SYSTEM"]
export const ROW_DENSITIES: readonly RowDensityChoice[] = ["COMPACT", "DEFAULT", "COMFORTABLE"]

export const SIDEBAR_LABELS: Record<SidebarStyle, string> = { DARK: "Dark", LIGHT: "Light", TINTED: "Tinted" }
export const MODE_LABELS: Record<ThemeModeChoice, string> = { LIGHT: "Light", DARK: "Dark", SYSTEM: "Match my computer" }
export const DENSITY_LABELS: Record<RowDensityChoice, string> = { COMPACT: "Compact", DEFAULT: "Default", COMFORTABLE: "Comfortable" }

// PSAsync indigo, the default for a company that has chosen nothing
export const PSASYNC_ACCENT = "#5E56E0"
export const DEFAULT_SIDEBAR: SidebarStyle = "DARK"
// Light until every page is restyled for dark mode (the unconverted pages
// are listed in PSAsync-Design-Rules.md); then it goes back to SYSTEM.
// Companies and users can still choose Dark or Match my computer.
export const DEFAULT_MODE: ThemeModeChoice = "LIGHT"
export const DEFAULT_DENSITY: RowDensityChoice = "DEFAULT"

// The ten accent presets, exactly as in the mockup
export const ACCENT_PRESETS: readonly { name: string; hex: string }[] = [
  { name: "PSAsync indigo", hex: "#5E56E0" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Teal", hex: "#0F8B8D" },
  { name: "Green", hex: "#2E8B57" },
  { name: "Amber", hex: "#D97706" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Red", hex: "#DC2626" },
  { name: "Pink", hex: "#DB2777" },
  { name: "Purple", hex: "#9333EA" },
  { name: "Slate", hex: "#475569" },
]

// What the theme fields accept: #RRGGBB, as the mockup's valid() does
export function isThemeHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
}

// "#abc123" or "abc123" typed in the custom color box, as #ABC123, or null
export function readHexInput(text: string): string | null {
  const trimmed = text.trim()
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`
  return isThemeHex(hex) ? hex.toUpperCase() : null
}

export function accentName(hex: string): string {
  return ACCENT_PRESETS.find((p) => p.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex.toUpperCase()
}

// ─── Color math (the mockup's helpers) ─────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const x = hex.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]
}

export function rgbToHex(c: readonly number[]): string {
  return "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")
}

// a moved toward b by t (0 keeps a, 1 is b)
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex(x.map((v, i) => v * (1 - t) + y[i] * t))
}

// The mockup's ratio(): the same WCAG formula the action button check uses
export const ratio = contrastRatio

const WHITE = "#FFFFFF"
const NEAR_BLACK = "#111827"

// Text on a surface filled with this color: white when it reads at 4.5 to
// 1, otherwise whichever of white and near black reads better
export function onColor(hex: string): string {
  const white = ratio(hex, WHITE)
  if (white >= 4.5) return WHITE
  return white >= ratio(hex, NEAR_BLACK) ? WHITE : NEAR_BLACK
}

// "rgba(255,255,255,0.14)" over a solid color, as a solid color, so a
// contrast check can measure it
export function overlayWhite(base: string, alpha: number): string {
  return mix(base, WHITE, alpha)
}

// ─── Theme values ───────────────────────────────────────────────────────────

export interface ThemeTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  neuTint: string
  // The accent as a fill (buttons, the logo tile) and the text on it
  acc: string
  accOn: string
  // A pale accent background, and the accent as readable text on surfaces,
  // the page background, and the tint
  accTint: string
  accInk: string
  // The ink as a fill with its own readable text, for older components
  // that use one color for both text and fills (shadcn's --primary)
  inkOn: string
  sbBg: string
  sbText: string
  sbMuted: string
  sbActive: string
  sbActiveText: string
  sbHover: string
  sbBorder: string
  sbBadge: string
  sbBadgeText: string
  ok: string
  okTint: string
  warn: string
  warnTint: string
  bad: string
  badTint: string
}

const LIGHT_NEUTRALS = { bg: "#F4F5F8", surface: "#FFFFFF", surface2: "#F8F9FB", border: "#E3E6EC", text: "#141821", muted: "#5A6372", neuTint: "#EEF0F4" }
const DARK_NEUTRALS = { bg: "#0E1016", surface: "#161922", surface2: "#1C2029", border: "#2A2F3B", text: "#E9EBF1", muted: "#A2A9B7", neuTint: "#262B36" }

// Fixed for everyone, in both modes: they never follow the accent
export const STATUS_COLORS = {
  light: { ok: "#18794A", okTint: "#E2F4EA", warn: "#995107", warnTint: "#FCF0DC", bad: "#BC2B2A", badTint: "#FCE7E6" },
  dark: { ok: "#5CC98A", okTint: "#173325", warn: "#F0B35A", warnTint: "#3A2A12", bad: "#F07B76", badTint: "#3D1C1C" },
} as const

// The mockup's theme(), unchanged (the tinted sidebar's rgba values as the
// mockup writes them). Kept so a test can compare buildTheme against it.
export function mockupTheme(accent: string, sidebar: SidebarStyle, dark: boolean): Record<string, string> {
  const n = dark ? DARK_NEUTRALS : LIGHT_NEUTRALS
  let accInk = dark ? mix(accent, WHITE, 0.35) : accent
  if (!dark) {
    let k = 0
    while (ratio(accInk, WHITE) < 4.6 && k < 8) {
      accInk = mix(accInk, "#000000", 0.12)
      k++
    }
  }
  const s = dark ? STATUS_COLORS.dark : STATUS_COLORS.light
  const t: Record<string, string> = {
    ...n,
    acc: accent,
    accOn: onColor(accent),
    accInk,
    accTint: dark ? mix(accent, n.surface, 0.78) : mix(accent, WHITE, 0.88),
    ...s,
  }
  if (sidebar === "LIGHT") {
    Object.assign(t, { sbBg: n.surface, sbText: n.text, sbMuted: n.muted, sbActive: t.accTint, sbActiveText: accInk, sbHover: n.surface2, sbBorder: n.border, sbBadge: accent })
  } else if (sidebar === "TINTED") {
    const base = mix(accent, "#06070B", 0.62)
    Object.assign(t, {
      sbBg: base,
      sbText: "#EEF0F6",
      sbMuted: mix(accent, WHITE, 0.62),
      sbActive: "rgba(255,255,255,0.14)",
      sbActiveText: WHITE,
      sbHover: "rgba(255,255,255,0.08)",
      sbBorder: "rgba(255,255,255,0.10)",
      sbBadge: WHITE,
    })
  } else {
    Object.assign(t, {
      sbBg: dark ? "#0A0B10" : "#14161F",
      sbText: "#D2D6E0",
      sbMuted: "#8D94A4",
      sbActive: mix(accent, "#14161F", 0.55),
      sbActiveText: WHITE,
      sbHover: "rgba(255,255,255,0.06)",
      sbBorder: "rgba(255,255,255,0.08)",
      sbBadge: accent,
    })
  }
  return t
}

// Text needs 4.5 to 1; a fill next to a surface (a button's edge) 3 to 1
export const MIN_TEXT_CONTRAST = 4.5
export const MIN_UI_CONTRAST = 3

// The accent as a button fill: the accent itself unless it fails, then
// moved in small steps until its text reads at 4.5 to 1 and it stands out
// from the surface at 3 to 1. Only custom colors and a few presets move
// (Teal and Green in both modes, Slate in dark), and only slightly.
function readableFill(accent: string, surface: string, dark: boolean): { acc: string; accOn: string } {
  let fill = accent
  for (let k = 0; k < 24; k++) {
    const on = onColor(fill)
    if (ratio(fill, surface) < MIN_UI_CONTRAST) {
      fill = mix(fill, dark ? WHITE : "#000000", 0.06)
    } else if (ratio(fill, on) < MIN_TEXT_CONTRAST) {
      fill = mix(fill, on === WHITE ? "#000000" : WHITE, 0.06)
    } else {
      return { acc: fill, accOn: on }
    }
  }
  return { acc: fill, accOn: onColor(fill) }
}

// The mockup's ink, then moved on (darker in light mode, lighter in dark)
// until it reads at 4.5 to 1 on the surface, the page background, the
// tint, and with its own text on it as a fill
function readableInk(start: string, n: typeof LIGHT_NEUTRALS, tint: string, dark: boolean): string {
  let ink = start
  const toward = dark ? WHITE : "#000000"
  const step = dark ? 0.08 : 0.12
  for (let k = 0; k < 24; k++) {
    const ok =
      ratio(ink, n.surface) >= (dark ? MIN_TEXT_CONTRAST : 4.6) &&
      ratio(ink, n.bg) >= MIN_TEXT_CONTRAST &&
      ratio(ink, tint) >= MIN_TEXT_CONTRAST &&
      ratio(ink, onColor(ink)) >= MIN_TEXT_CONTRAST
    if (ok) return ink
    ink = mix(ink, toward, step)
  }
  return ink
}

// The theme for one accent, sidebar style, and mode. Every value is a
// solid #rrggbb except the sidebar overlays (rgba), which are measured over
// the sidebar's own background.
export function buildTheme(accentInput: string, sidebar: SidebarStyle, dark: boolean): ThemeTokens {
  const accent = isThemeHex(accentInput) ? accentInput.toUpperCase() : PSASYNC_ACCENT
  const m = mockupTheme(accent, sidebar, dark)
  const n = dark ? DARK_NEUTRALS : LIGHT_NEUTRALS
  const { acc, accOn } = readableFill(accent, n.surface, dark)
  const accTint = m.accTint
  const accInk = readableInk(m.accInk, n, accTint, dark)
  const t: ThemeTokens = {
    bg: n.bg,
    surface: n.surface,
    surface2: n.surface2,
    border: n.border,
    text: n.text,
    muted: n.muted,
    neuTint: n.neuTint,
    acc,
    accOn,
    accTint,
    accInk,
    inkOn: onColor(accInk),
    sbBg: m.sbBg,
    sbText: m.sbText,
    sbMuted: m.sbMuted,
    sbActive: m.sbActive,
    sbActiveText: m.sbActiveText,
    sbHover: m.sbHover,
    sbBorder: m.sbBorder,
    sbBadge: acc,
    sbBadgeText: accOn,
    ok: m.ok,
    okTint: m.okTint,
    warn: m.warn,
    warnTint: m.warnTint,
    bad: m.bad,
    badTint: m.badTint,
  }
  if (sidebar === "LIGHT") {
    t.sbActiveText = accInk
  } else if (sidebar === "TINTED") {
    // The mockup's badge: white text on a light overlay
    t.sbBadge = "rgba(255,255,255,0.18)"
    t.sbBadgeText = WHITE
    // A very light custom accent makes a sidebar too pale for its white
    // text on the selected row: darken the sidebar until it reads
    let base = t.sbBg
    for (let k = 0; k < 12 && ratio(WHITE, overlayWhite(base, 0.14)) < MIN_TEXT_CONTRAST; k++) base = mix(base, "#06070B", 0.1)
    t.sbBg = base
    // A custom accent can leave the muted text faint on its own sidebar
    let muted = t.sbMuted
    for (let k = 0; k < 12 && ratio(muted, t.sbBg) < MIN_TEXT_CONTRAST; k++) muted = mix(muted, WHITE, 0.15)
    t.sbMuted = muted
  } else {
    // A very light custom accent would make the selected row too pale for
    // its white text
    let active = t.sbActive
    for (let k = 0; k < 12 && ratio(WHITE, active) < MIN_TEXT_CONTRAST; k++) active = mix(active, "#14161F", 0.15)
    t.sbActive = active
  }
  return t
}

// A solid version of a sidebar color, for contrast checks: the overlays are
// measured over the sidebar background
export function solidSidebarColor(value: string, sbBg: string): string {
  const match = /^rgba\(255,255,255,([0-9.]+)\)$/.exec(value)
  return match ? overlayWhite(sbBg, Number(match[1])) : value
}

// ─── Resolution ─────────────────────────────────────────────────────────────

export interface CompanyThemeInput {
  themeAccent?: string | null
  themeSidebar?: SidebarStyle | null
  themeMode?: ThemeModeChoice | null
  allowUserTheme?: boolean | null
}

export interface UserThemeInput {
  themeAccent?: string | null
  themeSidebar?: SidebarStyle | null
  themeMode?: ThemeModeChoice | null
}

export interface ResolvedTheme {
  accent: string
  sidebar: SidebarStyle
  mode: ThemeModeChoice
}

const validSidebar = (v: unknown): v is SidebarStyle => typeof v === "string" && (SIDEBAR_STYLES as readonly string[]).includes(v)
const validMode = (v: unknown): v is ThemeModeChoice => typeof v === "string" && (THEME_MODES as readonly string[]).includes(v)

export function isSidebarStyle(v: unknown): v is SidebarStyle {
  return validSidebar(v)
}
export function isThemeMode(v: unknown): v is ThemeModeChoice {
  return validMode(v)
}
export function isRowDensity(v: unknown): v is RowDensityChoice {
  return typeof v === "string" && (ROW_DENSITIES as readonly string[]).includes(v)
}

// Whether the company lets users pick their own colors (on unless turned off)
export function allowsUserTheme(company: CompanyThemeInput | null | undefined): boolean {
  return company?.allowUserTheme !== false
}

// The company's own defaults, with the PSAsync default for anything it
// hasn't chosen (or holds an invalid value for)
export function companyTheme(company: CompanyThemeInput | null | undefined): ResolvedTheme {
  return {
    accent: isThemeHex(company?.themeAccent) ? company.themeAccent.toUpperCase() : PSASYNC_ACCENT,
    sidebar: validSidebar(company?.themeSidebar) ? company.themeSidebar : DEFAULT_SIDEBAR,
    mode: validMode(company?.themeMode) ? company.themeMode : DEFAULT_MODE,
  }
}

// What a user sees: each of their own choices wins over the company
// default, but only while the company allows personal colors; anything
// missing or invalid falls back to the company default, then the PSAsync
// default
export function resolveTheme(company: CompanyThemeInput | null | undefined, user: UserThemeInput | null | undefined): ResolvedTheme {
  const base = companyTheme(company)
  if (!allowsUserTheme(company) || !user) return base
  return {
    accent: isThemeHex(user.themeAccent) ? user.themeAccent.toUpperCase() : base.accent,
    sidebar: validSidebar(user.themeSidebar) ? user.themeSidebar : base.sidebar,
    mode: validMode(user.themeMode) ? user.themeMode : base.mode,
  }
}

// "PSAsync indigo, dark sidebar, light"
export function describeTheme(theme: ResolvedTheme): string {
  return `${accentName(theme.accent)}, ${SIDEBAR_LABELS[theme.sidebar].toLowerCase()} sidebar, ${MODE_LABELS[theme.mode].toLowerCase()}`
}

// ─── CSS ────────────────────────────────────────────────────────────────────

// The CSS variable for each value, the mockup's names with a --ps- prefix
export const THEME_VARIABLES: Record<keyof ThemeTokens, string> = {
  bg: "--ps-bg",
  surface: "--ps-surface",
  surface2: "--ps-surface-2",
  border: "--ps-border",
  text: "--ps-text",
  muted: "--ps-muted",
  neuTint: "--ps-neu-tint",
  acc: "--ps-acc",
  accOn: "--ps-acc-on",
  accTint: "--ps-acc-tint",
  accInk: "--ps-acc-ink",
  inkOn: "--ps-ink-on",
  sbBg: "--ps-sb-bg",
  sbText: "--ps-sb-text",
  sbMuted: "--ps-sb-muted",
  sbActive: "--ps-sb-active",
  sbActiveText: "--ps-sb-active-text",
  sbHover: "--ps-sb-hover",
  sbBorder: "--ps-sb-border",
  sbBadge: "--ps-sb-badge",
  sbBadgeText: "--ps-sb-badge-text",
  ok: "--ps-ok",
  okTint: "--ps-ok-tint",
  warn: "--ps-warn",
  warnTint: "--ps-warn-tint",
  bad: "--ps-bad",
  badTint: "--ps-bad-tint",
}

// Only values this module made reach the CSS: hex colors and the fixed
// rgba overlays. Anything else would mean a bug, so it is dropped.
const SAFE_VALUE = /^(#[0-9a-fA-F]{6}|rgba\(255,255,255,0\.[0-9]+\))$/

export function themeDeclarations(tokens: ThemeTokens): string {
  return (Object.keys(THEME_VARIABLES) as (keyof ThemeTokens)[])
    .filter((key) => SAFE_VALUE.test(tokens[key]))
    .map((key) => `${THEME_VARIABLES[key]}:${tokens[key]};`)
    .join("")
}

// The stylesheet for a theme, for the html element. Both modes are always
// written: the light values on :root, the dark ones on :root.dark (the
// class next-themes sets before the page paints). For "match my computer"
// a prefers-color-scheme query also switches to the dark values, so the
// colors are right even before that class is set.
export function themeCss(theme: ResolvedTheme): string {
  const light = themeDeclarations(buildTheme(theme.accent, theme.sidebar, false))
  const dark = themeDeclarations(buildTheme(theme.accent, theme.sidebar, true))
  const parts = [`:root{${light}}`, `:root.dark{${dark}}`]
  if (theme.mode === "SYSTEM") parts.push(`@media (prefers-color-scheme: dark){:root:not(.light){${dark}}}`)
  return parts.join("")
}

// next-themes' value for a mode: a forced light or dark, or none for
// "match my computer", which then follows the system setting
export function forcedThemeFor(mode: ThemeModeChoice): "light" | "dark" | undefined {
  return mode === "LIGHT" ? "light" : mode === "DARK" ? "dark" : undefined
}

// The readability label under the custom color box: the accent's own text
// color on it, as the mockup shows it
export function accentReadability(accent: string): { ratio: number; readable: boolean; label: string } {
  const hex = isThemeHex(accent) ? accent : PSASYNC_ACCENT
  const r = ratio(hex, onColor(hex))
  const readable = r >= MIN_TEXT_CONTRAST
  const shown = r.toFixed(1)
  return {
    ratio: r,
    readable,
    label: readable ? `Readable: ${shown} to 1` : `Hard to read: ${shown} to 1. Buttons use a slightly adjusted shade so their text stays readable.`,
  }
}

// ─── Signed out pages ───────────────────────────────────────────────────────

// The customer portal, the sign in page, and every other page outside the
// staff app always show the PSAsync default theme in light mode, whatever
// the company, the user, or the computer prefers. Only /dashboard (the
// staff app, src/app/dashboard/layout.tsx) applies the signed in user's
// theme.
export const PUBLIC_THEME: ResolvedTheme = { accent: PSASYNC_ACCENT, sidebar: DEFAULT_SIDEBAR, mode: "LIGHT" }

export function isStaffThemedPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/")
}

// The root layout's stylesheet: the light default on :root and on
// :root.dark too, so a dark class left over from the staff app (a client
// side navigation out of it) can't darken a public page. The staff app
// writes its own theme after this one, which wins there.
export function publicThemeCss(): string {
  return `:root,:root.dark{${themeDeclarations(buildTheme(PUBLIC_THEME.accent, PUBLIC_THEME.sidebar, false))}}`
}
