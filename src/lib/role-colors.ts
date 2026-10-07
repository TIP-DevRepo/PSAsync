// Role colors are stored as "#RRGGBB" (or null for no color) and rendered
// through the .role-pill class in globals.css, which mixes the color toward
// black in light mode and toward white in dark mode so even very light or
// very dark colors keep readable text.

// Preset swatches for the role color picker in Roles & Permissions.
export const ROLE_COLOR_PALETTE = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#EAB308",
  "#84CC16",
  "#22C55E",
  "#10B981",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#EC4899",
  "#64748B",
] as const

// Fixed colors for the two locked roles, and the fallback for roles that
// haven't been given a color yet.
export const GLOBAL_ADMIN_ROLE_COLOR = "#F59E0B"
export const NEUTRAL_ROLE_COLOR = "#71717A"

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function isValidRoleColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value)
}

// Reads a color from an API request body. Returns undefined when the body
// doesn't set one, null to clear it, the uppercased hex when valid, or
// false when it's malformed.
export function readRoleColor(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  if (!isValidRoleColor(value)) return false
  return value.toUpperCase()
}

// The color a role's pill is actually drawn in.
export function roleDisplayColor(role: { color?: string | null; isGlobalAdmin?: boolean; isEveryone?: boolean }): string {
  if (role.isGlobalAdmin) return GLOBAL_ADMIN_ROLE_COLOR
  if (role.isEveryone) return NEUTRAL_ROLE_COLOR
  return isValidRoleColor(role.color) ? role.color : NEUTRAL_ROLE_COLOR
}
