// The action buttons above a timeline (ActionButtonBar in
// src/components/timeline/). Each company defines its own (the ActionButton
// model, Settings > Action Buttons), shared by opportunities and tickets;
// the API hands them to the page as plain, serializable definitions, so the
// same bar works for any record. No React and no database imports.

// Icons are names, not components, so a stored button stays valid as the
// UI changes. The bar maps each to a lucide icon.
export const ACTION_BUTTON_ICONS = [
  "note",
  "email",
  "won",
  "lost",
  "call",
  "meeting",
  "task",
  "quote",
  "ticket",
  "flag",
  "star",
  "clock",
  "check",
  "alert",
  "user",
  "send",
] as const

export type ActionButtonIcon = (typeof ACTION_BUTTON_ICONS)[number]

export function isActionButtonIcon(value: unknown): value is ActionButtonIcon {
  return typeof value === "string" && (ACTION_BUTTON_ICONS as readonly string[]).includes(value)
}

// The ActionButtonKind enum's values
export const ACTION_BUTTON_KINDS = ["NOTE", "EMAIL", "RAISE_QUOTE", "APPOINTMENT", "CHILD_TICKET"] as const
export type ActionButtonKindName = (typeof ACTION_BUTTON_KINDS)[number]

export const ACTION_KIND_LABELS: Record<ActionButtonKindName, string> = {
  NOTE: "Note",
  EMAIL: "Email",
  RAISE_QUOTE: "Raise quote",
  APPOINTMENT: "Appointment",
  CHILD_TICKET: "Child ticket",
}

// The kinds whose feature exists, the one list that decides which buttons
// show on records. The others can be configured in Settings now and stay
// hidden on records until a later branch builds the feature and adds the
// kind here (Raise Quote is next).
export const AVAILABLE_ACTION_KINDS: readonly ActionButtonKindName[] = ["NOTE", "EMAIL"]

export function isAvailableActionKind(kind: string): boolean {
  return (AVAILABLE_ACTION_KINDS as readonly string[]).includes(kind)
}

// Only these kinds can change the record's stage
export const STAGE_CHANGING_KINDS: readonly ActionButtonKindName[] = ["NOTE", "EMAIL"]

export type ActionStageModeName = "NONE" | "CHOOSE" | "FIXED"
export type ActionNoteModeName = "OPTIONAL" | "REQUIRED"

// The record types a button can show on. Tickets come later.
export type ActionButtonRecordType = "opportunity"

export interface ActionButtonDefinition {
  id: string
  label: string
  icon: ActionButtonIcon
  // #RRGGBB, the button's fill; the text color is picked for contrast
  color: string
  // What the button opens: the note or email composer, with its stage rule
  // (none, the user chooses, or one fixed stage, by id or by the first stage
  // of a category in the company's order) and whether text is required
  opens: {
    kind: "note" | "email"
    stageMode: ActionStageModeName
    stage?: { id?: string; category?: "OPEN" | "WON" | "LOST" }
    noteRequired: boolean
  }
}

// A stored button (the fields the API reads) as the bar's definition, or
// null for a kind the bar can't open yet
export function toActionButtonDefinition(row: {
  id: string
  label: string
  icon: string
  color: string
  kind: string
  stageMode: string
  fixedStageId: string | null
  noteMode: string
}): ActionButtonDefinition | null {
  if (row.kind !== "NOTE" && row.kind !== "EMAIL") return null
  const stageMode: ActionStageModeName = row.stageMode === "CHOOSE" || row.stageMode === "FIXED" ? row.stageMode : "NONE"
  return {
    id: row.id,
    label: row.label,
    icon: isActionButtonIcon(row.icon) ? row.icon : "note",
    color: isHexColor(row.color) ? row.color : DEFAULT_BUTTON_COLOR,
    opens: {
      kind: row.kind === "EMAIL" ? "email" : "note",
      stageMode,
      ...(stageMode === "FIXED" && row.fixedStageId ? { stage: { id: row.fixedStageId } } : {}),
      noteRequired: row.noteMode !== "OPTIONAL",
    },
  }
}

// The stage a button preselects in the composer, or "" for no change. stages
// are in the company's order. A preset that matches no stage (deleted, or
// a company with no stage of that category) preselects nothing.
export function presetStageId(button: ActionButtonDefinition, stages: readonly { id: string; category: string }[]): string {
  if (button.opens.stageMode !== "FIXED") return ""
  const preset = button.opens.stage
  if (!preset) return ""
  if (preset.id) return stages.some((s) => s.id === preset.id) ? preset.id : ""
  if (preset.category) return stages.find((s) => s.category === preset.category)?.id ?? ""
  return ""
}

// ─── Colors ─────────────────────────────────────────────────────────────

export const DEFAULT_BUTTON_COLOR = "#1B3A5C"

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)
}

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

// WCAG relative luminance of a #RRGGBB color
export function relativeLuminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

// WCAG contrast ratio between two #RRGGBB colors, 1 to 21
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const LIGHT_TEXT = "#FFFFFF"
const DARK_TEXT = "#111827"

// The text color for a button filled with this color: white or near black,
// whichever reads better
export function buttonTextColor(fill: string): string {
  if (!isHexColor(fill)) return LIGHT_TEXT
  return contrastRatio(fill, LIGHT_TEXT) >= contrastRatio(fill, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT
}

// Normal text needs 4.5:1 (WCAG AA)
export const MIN_TEXT_CONTRAST = 4.5

// A warning for the color picker when even the better text color is hard
// to read on this fill, or null when it reads well
export function buttonContrastWarning(fill: string): string | null {
  if (!isHexColor(fill)) return null
  const ratio = contrastRatio(fill, buttonTextColor(fill))
  if (ratio >= MIN_TEXT_CONTRAST) return null
  return `The label may be hard to read on this color (contrast ${ratio.toFixed(1)}:1, at least ${MIN_TEXT_CONTRAST}:1 is recommended). Choose a darker or lighter color.`
}
