// The action buttons above a timeline (ActionButtonBar in
// src/components/timeline/). Each button is a plain, serializable
// definition, so a later branch can store admin defined buttons for
// opportunities and tickets and feed them to the same bar. No React and no
// database imports.

// Icons and colors are names, not components or classes, so a stored
// definition stays valid as the UI changes
export type ActionButtonIcon = "note" | "won" | "lost" | "email" | "call" | "meeting" | "task"
export type ActionButtonColor = "neutral" | "primary" | "success" | "danger" | "warning" | "info"

export interface ActionButtonDefinition {
  id: string
  label: string
  icon: ActionButtonIcon
  color: ActionButtonColor
  // What the button opens, with any preset values. Today only the note
  // composer, optionally with a stage preselected: a stage id, or the first
  // stage (in the company's order) of a category.
  opens: { kind: "note"; stage?: { id?: string; category?: "OPEN" | "WON" | "LOST" } }
}

// The fixed buttons on an opportunity this round
export const OPPORTUNITY_ACTION_BUTTONS: readonly ActionButtonDefinition[] = [
  { id: "note", label: "Note", icon: "note", color: "primary", opens: { kind: "note" } },
  { id: "won", label: "Won", icon: "won", color: "success", opens: { kind: "note", stage: { category: "WON" } } },
  { id: "lost", label: "Lost", icon: "lost", color: "danger", opens: { kind: "note", stage: { category: "LOST" } } },
]

// The stage a button preselects in the composer, or "" for no change. stages
// are in the company's order. A preset that matches no stage (deleted, or
// a company with no stage of that category) preselects nothing.
export function presetStageId(button: ActionButtonDefinition, stages: readonly { id: string; category: string }[]): string {
  const preset = button.opens.stage
  if (!preset) return ""
  if (preset.id) return stages.some((s) => s.id === preset.id) ? preset.id : ""
  if (preset.category) return stages.find((s) => s.category === preset.category)?.id ?? ""
  return ""
}
