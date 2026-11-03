"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { DndContext, closestCenter, type DragEndEvent, type UniqueIdentifier } from "@dnd-kit/core"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/Modal"
import { useAccess } from "@/components/AccessProvider"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"
import { announcementsFor, DragHandle, errorOf, SectionError, send, useReorderSensors } from "@/components/settings/OpportunitySettingsPanel"
import { ACTION_BUTTON_ICON_COMPONENTS, ActionButtonPill } from "@/components/timeline/ActionButtonBar"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { cn } from "@/lib/utils"
import { CATEGORY_LABELS } from "@/lib/opportunity-rules"
import type { StageCategory } from "@/lib/opportunity-view"
import { ACTION_BUTTON_LABEL_MAX, checkActionButton } from "@/lib/action-button-rules"
import {
  ACTION_BUTTON_ICONS,
  ACTION_BUTTON_KINDS,
  ACTION_KIND_LABELS,
  DEFAULT_BUTTON_COLOR,
  STAGE_CHANGING_KINDS,
  buttonContrastWarning,
  buttonTextColor,
  contrastRatio,
  isAvailableActionKind,
  isHexColor,
  type ActionButtonIcon,
  type ActionButtonKindName,
  type ActionNoteModeName,
  type ActionStageModeName,
} from "@/lib/timeline-buttons"

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
const LABEL = "mb-1 block text-sm font-medium text-foreground"

// One button as GET /api/action-buttons returns it
interface StoredButton {
  id: string
  label: string
  icon: ActionButtonIcon
  color: string
  forOpportunities: boolean
  forTickets: boolean
  kind: ActionButtonKindName
  stageMode: ActionStageModeName
  fixedStageId: string | null
  fixedStage: { id: string; name: string; category: StageCategory } | null
  noteMode: ActionNoteModeName
  isHidden: boolean
  sortOrder: number
  // False for a kind whose feature doesn't exist yet
  available: boolean
}

interface StageOption {
  id: string
  name: string
  category: StageCategory
}

const STAGE_GROUPS: StageCategory[] = ["OPEN", "WON", "LOST"]

const STAGE_MODE_LABELS: Record<ActionStageModeName, string> = {
  NONE: "Doesn't change the stage",
  CHOOSE: "User chooses a stage",
  FIXED: "Always moves to one stage",
}

function showsOnText(b: { forOpportunities: boolean; forTickets: boolean }): string {
  if (b.forOpportunities && b.forTickets) return "Opportunities and tickets"
  return b.forOpportunities ? "Opportunities" : "Tickets"
}

function stageText(b: StoredButton): string | null {
  if (!STAGE_CHANGING_KINDS.includes(b.kind)) return null
  if (b.stageMode === "FIXED") return b.fixedStage ? `Moves to ${b.fixedStage.name}` : "Moves to a stage"
  return b.stageMode === "CHOOSE" ? "User chooses a stage" : null
}

// Settings > Action Buttons (settingsSections.actionButtons): the buttons
// above a record's timeline, in order, dragged to reorder, each with a live
// preview, where it shows, what it does, and whether it is hidden. Kinds
// whose feature doesn't exist yet can be set up and say "Coming later".
// Buttons are created and edited in a dialog; a refused change shows the
// API's own message.
export function ActionButtonsSettingsPanel() {
  const { can } = useAccess()
  const allowed = can("settingsSections.actionButtons")
  const [buttons, setButtons] = useState<StoredButton[] | null>(null)
  const [stages, setStages] = useState<StageOption[]>([])
  const [brand, setBrand] = useState<{ primaryColor: string; accentColor: string } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // null closed, "new", or the button being edited
  const [editing, setEditing] = useState<StoredButton | "new" | null>(null)
  const sensors = useReorderSensors()

  useEffect(() => {
    if (!allowed) return
    const json = (res: Response) => (res.ok ? res.json() : Promise.reject(new Error("refused")))
    fetch("/api/action-buttons")
      .then(json)
      .then((data: StoredButton[]) => setButtons(data))
      .catch(() => setLoadFailed(true))
    fetch("/api/opportunity-stages")
      .then(json)
      .then((data: StageOption[]) => setStages(data))
      .catch(() => setLoadFailed(true))
    // The brand colors for the palette; the defaults stand in if this fails
    fetch("/api/company-settings")
      .then(json)
      .then((data: { primaryColor?: unknown; accentColor?: unknown }) =>
        setBrand({
          primaryColor: isHexColor(data.primaryColor) ? data.primaryColor : "#1B3A5C",
          accentColor: isHexColor(data.accentColor) ? data.accentColor : "#2E86AB",
        })
      )
      .catch(() => setBrand(null))
  }, [allowed])

  if (!allowed) return <SettingsNoAccess />
  if (loadFailed) return <p className="text-sm text-danger">Couldn&apos;t load the action buttons. Refresh to try again.</p>
  if (!buttons) return <p className="text-sm text-muted-foreground">Loading...</p>

  const buttonName = (id: UniqueIdentifier) => buttons.find((b) => b.id === String(id))?.label ?? "button"

  async function reload() {
    const res = await fetch("/api/action-buttons")
    if (res.ok) setButtons(await res.json())
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!buttons) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = buttons.findIndex((b) => b.id === active.id)
    const to = buttons.findIndex((b) => b.id === over.id)
    if (from < 0 || to < 0) return
    const previous = buttons
    const next = arrayMove(buttons, from, to)
    setButtons(next)
    setBusy(true)
    setError(null)
    const { ok, data } = await send("/api/action-buttons/reorder", "POST", { buttonIds: next.map((b) => b.id) })
    setBusy(false)
    if (!ok) {
      setButtons(previous)
      setError(errorOf(data, "Couldn't save the new button order."))
      return
    }
    setButtons(data as StoredButton[])
    toast.success("Button order saved")
  }

  async function handleDelete(button: StoredButton) {
    const confirmed = await confirmDialog({
      title: `Delete the ${button.label} button?`,
      description: "It disappears from every record. Entries already made with it keep its name. This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    const { ok, data } = await send(`/api/action-buttons/${button.id}`, "DELETE")
    setBusy(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't delete the button."))
      return
    }
    toast.success(`Button ${button.label} deleted`)
    reload()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          The buttons above an opportunity&apos;s timeline (and a ticket&apos;s, later). Everyone who can open a record sees its buttons; using them needs edit access. Drag to change their order.
        </p>
        <Button onClick={() => setEditing("new")} disabled={busy} className="gap-1">
          <Plus size={14} aria-hidden="true" />
          New button
        </Button>
      </div>
      <SectionError message={error} onDismiss={() => setError(null)} />

      {/* DndContext renders hidden elements where it sits, so it wraps the list, never inside it */}
      <DndContext id="action-buttons-order" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements: announcementsFor(buttonName) }}>
        <SortableContext items={buttons.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {buttons.map((button) => (
              <ButtonRow key={button.id} button={button} busy={busy} onEdit={() => setEditing(button)} onDelete={() => handleDelete(button)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {editing && (
        <ButtonDialog
          button={editing === "new" ? null : editing}
          stages={stages}
          brand={brand}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function ButtonRow({ button, busy, onEdit, onDelete }: { button: StoredButton; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: button.id, disabled: busy })
  const stage = stageText(button)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border bg-card py-2 pl-1 pr-3 text-sm", isDragging && "relative z-10 scale-[1.02] shadow-popover")}
    >
      <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={`Reorder ${button.label}`} disabled={busy} />
      <div className={cn("shrink-0", button.isHidden && "opacity-60")}>
        <ActionButtonPill as="span" label={button.label} icon={button.icon} color={button.color} />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{ACTION_KIND_LABELS[button.kind]}</span>
        <span>{showsOnText(button)}</span>
        {stage && <span>{stage}</span>}
        {STAGE_CHANGING_KINDS.includes(button.kind) && <span>{button.noteMode === "REQUIRED" ? "Text required" : "Text optional"}</span>}
        {button.isHidden && <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">Hidden</span>}
        {!button.available && (
          <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info" title="This action isn't built yet. The button shows on records once it is.">
            Coming later
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button type="button" onClick={onEdit} disabled={busy} className="text-xs font-medium text-primary hover:underline disabled:opacity-60">
          Edit
        </button>
        <button type="button" onClick={onDelete} disabled={busy} className="text-xs font-medium text-muted-foreground hover:text-danger disabled:opacity-60">
          Delete
        </button>
      </div>
    </li>
  )
}

// Create or edit one button. Every field is checked with the same rules as
// the API (checkActionButton) before saving; the API's message is shown if
// it refuses anyway.
function ButtonDialog({
  button,
  stages,
  brand,
  onClose,
  onSaved,
}: {
  button: StoredButton | null
  stages: StageOption[]
  brand: { primaryColor: string; accentColor: string } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState(button?.label ?? "")
  const [icon, setIcon] = useState<ActionButtonIcon>(button?.icon ?? "note")
  const [color, setColor] = useState(button?.color ?? brand?.primaryColor ?? DEFAULT_BUTTON_COLOR)
  // The hex field as typed, so a half typed color doesn't jump around
  const [hexInput, setHexInput] = useState(color)
  const [forOpportunities, setForOpportunities] = useState(button?.forOpportunities ?? true)
  const [forTickets, setForTickets] = useState(button?.forTickets ?? false)
  const [kind, setKind] = useState<ActionButtonKindName>(button?.kind ?? "NOTE")
  const [stageMode, setStageMode] = useState<ActionStageModeName>(button?.stageMode ?? "NONE")
  const [fixedStageId, setFixedStageId] = useState(button?.fixedStageId ?? "")
  const [noteMode, setNoteMode] = useState<ActionNoteModeName>(button?.noteMode ?? "REQUIRED")
  const [isHidden, setIsHidden] = useState(button?.isHidden ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changesStage = STAGE_CHANGING_KINDS.includes(kind)
  const palette = [
    { name: "Brand primary", hex: brand?.primaryColor ?? "#1B3A5C" },
    { name: "Brand accent", hex: brand?.accentColor ?? "#2E86AB" },
    { name: "Green", hex: "#3A9742" },
    { name: "Red", hex: "#E62B34" },
    { name: "Amber", hex: "#B7791F" },
    { name: "Blue", hex: "#0B6BA8" },
    { name: "Purple", hex: "#6D28D9" },
    { name: "Gray", hex: "#4B5563" },
  ].filter((p, i, all) => all.findIndex((q) => q.hex.toUpperCase() === p.hex.toUpperCase()) === i)
  const contrastWarning = buttonContrastWarning(color)
  const ratio = contrastRatio(color, buttonTextColor(color))

  function pickColor(hex: string) {
    setColor(hex.toUpperCase())
    setHexInput(hex.toUpperCase())
  }

  async function handleSave() {
    const fields = {
      label,
      icon,
      color,
      forOpportunities,
      forTickets,
      kind,
      stageMode: changesStage ? stageMode : "NONE",
      fixedStageId: changesStage && stageMode === "FIXED" ? fixedStageId || null : null,
      noteMode,
      isHidden,
    }
    const checked = checkActionButton(fields)
    if (checked.error !== undefined) {
      setError(checked.error)
      return
    }
    setSaving(true)
    setError(null)
    const { ok, data } = button
      ? await send(`/api/action-buttons/${button.id}`, "PATCH", checked.value)
      : await send("/api/action-buttons", "POST", checked.value)
    setSaving(false)
    if (!ok) {
      setError(errorOf(data, "Couldn't save the button."))
      return
    }
    toast.success(button ? `Button ${checked.value.label} saved` : `Button ${checked.value.label} created`)
    onSaved()
  }

  return (
    <Modal maxWidth="xl" scrollable onClose={saving ? undefined : onClose}>
      <h2 className="text-lg font-bold text-foreground">{button ? `Edit ${button.label}` : "New button"}</h2>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          handleSave()
        }}
      >
        <SectionError message={error} onDismiss={() => setError(null)} />

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
          <span className="text-xs font-medium text-muted-foreground">Preview</span>
          <ActionButtonPill as="span" label={label.trim() || "Button"} icon={icon} color={isHexColor(color) ? color : DEFAULT_BUTTON_COLOR} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="action-button-label" className={LABEL}>
              Label <span className="text-danger">*</span>
            </label>
            <input id="action-button-label" value={label} maxLength={ACTION_BUTTON_LABEL_MAX} onChange={(e) => setLabel(e.target.value)} className={FIELD} autoFocus />
          </div>
          <div>
            <label htmlFor="action-button-kind" className={LABEL}>
              Action
            </label>
            <select id="action-button-kind" value={kind} onChange={(e) => setKind(e.target.value as ActionButtonKindName)} className={FIELD}>
              {ACTION_BUTTON_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACTION_KIND_LABELS[k]}
                  {isAvailableActionKind(k) ? "" : " (coming later)"}
                </option>
              ))}
            </select>
            {!isAvailableActionKind(kind) && (
              <p className="mt-1 text-xs text-muted-foreground">This action isn&apos;t built yet. The button can be set up now and shows on records once it is.</p>
            )}
          </div>
        </div>

        <fieldset>
          <legend className={LABEL}>Icon</legend>
          <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-2 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
            {ACTION_BUTTON_ICONS.map((name) => {
              const Icon = ACTION_BUTTON_ICON_COMPONENTS[name]
              const selected = icon === name
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={name}
                  title={name}
                  onClick={() => setIcon(name)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md border text-foreground transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-brand-primary-500 bg-brand-primary-500/10 text-brand-primary-500" : "border-border hover:bg-surface-hover"
                  )}
                >
                  <Icon size={16} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={LABEL}>Color</legend>
          <div className="flex flex-wrap gap-2">
            {palette.map((p) => {
              const selected = p.hex.toUpperCase() === color.toUpperCase()
              return (
                <button
                  key={p.hex}
                  type="button"
                  onClick={() => pickColor(p.hex)}
                  aria-pressed={selected}
                  aria-label={`${p.name} ${p.hex}`}
                  title={`${p.name} ${p.hex}`}
                  className={cn(
                    "h-8 w-8 rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    selected && "ring-2 ring-ring ring-offset-2 ring-offset-background"
                  )}
                  style={{ backgroundColor: p.hex }}
                />
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label="Pick a custom color"
              value={isHexColor(color) ? color.toLowerCase() : "#000000"}
              onChange={(e) => pickColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background"
            />
            <label htmlFor="action-button-hex" className="sr-only">
              Custom hex color
            </label>
            <input
              id="action-button-hex"
              value={hexInput}
              maxLength={7}
              placeholder="#1B3A5C"
              onChange={(e) => {
                const value = e.target.value.trim()
                setHexInput(value)
                if (isHexColor(value)) setColor(value.toUpperCase())
              }}
              className={cn(FIELD, "w-32 font-mono")}
            />
            {isHexColor(color) && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  contrastWarning ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                )}
              >
                Contrast {ratio.toFixed(1)}:1
              </span>
            )}
          </div>
          {!isHexColor(hexInput) && <p className="text-xs text-danger">Enter a hex color like #1B3A5C.</p>}
          {contrastWarning && <p className="text-xs text-warning">{contrastWarning}</p>}
        </fieldset>

        <fieldset>
          <legend className={LABEL}>Shows on</legend>
          <div className="flex flex-wrap gap-4 text-sm text-foreground">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={forOpportunities} onChange={(e) => setForOpportunities(e.target.checked)} className="accent-primary" />
              Opportunities
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={forTickets} onChange={(e) => setForTickets(e.target.checked)} className="accent-primary" />
              Tickets
            </label>
          </div>
        </fieldset>

        {changesStage && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="action-button-stage-mode" className={LABEL}>
                Stage
              </label>
              <select id="action-button-stage-mode" value={stageMode} onChange={(e) => setStageMode(e.target.value as ActionStageModeName)} className={FIELD}>
                {(Object.keys(STAGE_MODE_LABELS) as ActionStageModeName[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {STAGE_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
            {stageMode === "FIXED" && (
              <div>
                <label htmlFor="action-button-fixed-stage" className={LABEL}>
                  Moves to <span className="text-danger">*</span>
                </label>
                <select id="action-button-fixed-stage" value={fixedStageId} onChange={(e) => setFixedStageId(e.target.value)} className={FIELD}>
                  <option value="">Choose a stage</option>
                  {STAGE_GROUPS.map((category) => {
                    const inGroup = stages.filter((st) => st.category === category)
                    return inGroup.length === 0 ? null : (
                      <optgroup key={category} label={CATEGORY_LABELS[category]}>
                        {inGroup.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>
            )}
          </div>
        )}

        {changesStage && (
          <div className="sm:w-1/2 sm:pr-2">
            <label htmlFor="action-button-note-mode" className={LABEL}>
              {kind === "EMAIL" ? "Message text" : "Note text"}
            </label>
            <select id="action-button-note-mode" value={noteMode} onChange={(e) => setNoteMode(e.target.value as ActionNoteModeName)} className={FIELD}>
              <option value="REQUIRED">Required</option>
              <option value="OPTIONAL">Optional</option>
            </select>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={isHidden} onChange={(e) => setIsHidden(e.target.checked)} className="mt-0.5 accent-primary" />
          <span>
            Hide this button
            <span className="block text-xs text-muted-foreground">Hidden buttons stay here but don&apos;t show on records.</span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : button ? "Save button" : "Create button"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
