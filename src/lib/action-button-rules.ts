import {
  ACTION_BUTTON_KINDS,
  STAGE_CHANGING_KINDS,
  isActionButtonIcon,
  isHexColor,
  type ActionButtonIcon,
  type ActionButtonKindName,
  type ActionNoteModeName,
  type ActionStageModeName,
} from "@/lib/timeline-buttons"

// The rules an action button must follow, shared by the Action Buttons
// routes and the Settings dialog. No React and no database imports.

export const ACTION_BUTTON_LABEL_MAX = 40

export const ACTION_BUTTON_MESSAGES = {
  labelRequired: "Label is required",
  labelTooLong: `Label must be ${ACTION_BUTTON_LABEL_MAX} characters or fewer`,
  icon: "Choose an icon from the list",
  color: "Color must be a hex color like #1B3A5C",
  showsOn: "Choose where the button shows: opportunities, tickets, or both",
  kind: "Invalid action type",
  stageMode: "Invalid stage setting",
  noteMode: "Invalid note setting",
  stageKinds: "Only Note and Email buttons can change the stage",
  fixedStageRequired: "Choose the stage this button moves to",
  fixedStageOnlyWhenFixed: "A stage can only be set when the button always moves to one stage",
  hidden: "Hidden must be true or false",
  showsOnFlag: "Where the button shows must be true or false",
} as const

// The editable fields of a button, as stored
export interface ActionButtonFields {
  label: string
  icon: ActionButtonIcon
  color: string
  forOpportunities: boolean
  forTickets: boolean
  kind: ActionButtonKindName
  stageMode: ActionStageModeName
  fixedStageId: string | null
  noteMode: ActionNoteModeName
  isHidden: boolean
}

const STAGE_MODES: readonly ActionStageModeName[] = ["NONE", "CHOOSE", "FIXED"]
const NOTE_MODES: readonly ActionNoteModeName[] = ["OPTIONAL", "REQUIRED"]

export type ButtonCheck = { value: ActionButtonFields; error?: undefined } | { error: string; value?: undefined }

// Checks a whole button (a new one, or a stored one with a PATCH's fields
// laid over it). The label is trimmed and the color upper cased. The fixed
// stage id is only checked for shape here; the route checks it belongs to
// the company with assertRefs.
export function checkActionButton(input: Record<string, unknown>): ButtonCheck {
  const label = typeof input.label === "string" ? input.label.trim() : ""
  if (!label) return { error: ACTION_BUTTON_MESSAGES.labelRequired }
  if (label.length > ACTION_BUTTON_LABEL_MAX) return { error: ACTION_BUTTON_MESSAGES.labelTooLong }
  if (!isActionButtonIcon(input.icon)) return { error: ACTION_BUTTON_MESSAGES.icon }
  if (!isHexColor(input.color)) return { error: ACTION_BUTTON_MESSAGES.color }
  if (typeof input.forOpportunities !== "boolean" || typeof input.forTickets !== "boolean") {
    return { error: ACTION_BUTTON_MESSAGES.showsOnFlag }
  }
  if (!input.forOpportunities && !input.forTickets) return { error: ACTION_BUTTON_MESSAGES.showsOn }
  if (!(ACTION_BUTTON_KINDS as readonly unknown[]).includes(input.kind)) return { error: ACTION_BUTTON_MESSAGES.kind }
  const kind = input.kind as ActionButtonKindName
  if (!(STAGE_MODES as readonly unknown[]).includes(input.stageMode)) return { error: ACTION_BUTTON_MESSAGES.stageMode }
  const stageMode = input.stageMode as ActionStageModeName
  if (!(NOTE_MODES as readonly unknown[]).includes(input.noteMode)) return { error: ACTION_BUTTON_MESSAGES.noteMode }
  if (typeof input.isHidden !== "boolean") return { error: ACTION_BUTTON_MESSAGES.hidden }

  const rawStage = input.fixedStageId
  if (rawStage !== null && rawStage !== undefined && rawStage !== "" && typeof rawStage !== "string") {
    return { error: ACTION_BUTTON_MESSAGES.fixedStageRequired }
  }
  const fixedStageId = typeof rawStage === "string" && rawStage ? rawStage : null

  if (!STAGE_CHANGING_KINDS.includes(kind) && (stageMode !== "NONE" || fixedStageId)) {
    return { error: ACTION_BUTTON_MESSAGES.stageKinds }
  }
  if (stageMode === "FIXED" && !fixedStageId) return { error: ACTION_BUTTON_MESSAGES.fixedStageRequired }
  if (stageMode !== "FIXED" && fixedStageId) return { error: ACTION_BUTTON_MESSAGES.fixedStageOnlyWhenFixed }

  return {
    value: {
      label,
      icon: input.icon as ActionButtonIcon,
      color: (input.color as string).toUpperCase(),
      forOpportunities: input.forOpportunities,
      forTickets: input.forTickets,
      kind,
      stageMode,
      fixedStageId,
      noteMode: input.noteMode as ActionNoteModeName,
      isHidden: input.isHidden,
    },
  }
}

// The fields a request may set; anything else in the body is ignored
export const ACTION_BUTTON_FIELDS = [
  "label",
  "icon",
  "color",
  "forOpportunities",
  "forTickets",
  "kind",
  "stageMode",
  "fixedStageId",
  "noteMode",
  "isHidden",
] as const satisfies readonly (keyof ActionButtonFields)[]

// A stored button with a PATCH body's fields laid over it, for checkActionButton
export function mergeButtonPatch(stored: ActionButtonFields, body: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored }
  for (const key of ACTION_BUTTON_FIELDS) if (key in body) merged[key] = body[key]
  return merged
}
