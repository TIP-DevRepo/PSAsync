"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { Loader2, Pencil } from "lucide-react"
import { commitInlineEdit } from "@/lib/inline-edit"
import { cn } from "@/lib/utils"

// One field of a HaloPSA style details panel: the label above, the value
// below. Editable, hovering or keyboard focus outlines it with a small edit
// hint, and clicking it (or Enter) turns it into its editor in place. The
// parent decides which field is editing (only one at a time) and how a
// value saves; save shows its own error toast and returns false on a
// failure, which puts the old value back (commitInlineEdit). Read only (no
// edit permission), it shows plainly with no outline. Shared so tickets can
// use the same panel style.
export function InlineEditField<T>({
  label,
  value,
  renderValue,
  canEdit,
  editing,
  onEditingChange,
  onSave,
  renderEditor,
  aside,
  busy = false,
}: {
  label: string
  value: T
  // How a value shows, also used for the new value while it saves
  renderValue: (value: T) => ReactNode
  canEdit: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSave: (value: T) => Promise<boolean>
  // The editor, given the current value, commit (save a value) and cancel
  renderEditor: (editor: { value: T; commit: (next: T) => void; cancel: () => void }) => ReactNode
  // Something beside the label that is not part of the edit target (a link)
  aside?: ReactNode
  // A save the parent runs itself (for example a pair of fields saved together)
  busy?: boolean
}) {
  const ids = useId()
  const [pending, setPending] = useState<{ value: T } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(editing)

  // Keyboard focus goes back to the field when its editor closes
  useEffect(() => {
    if (wasEditing.current && !editing) buttonRef.current?.focus({ preventScroll: true })
    wasEditing.current = editing
  }, [editing])

  const saving = busy || pending !== null
  const shown = pending ? pending.value : value

  function commit(next: T) {
    onEditingChange(false)
    void commitInlineEdit({ current: value, next, save: onSave, setPending })
  }

  const labelRow = (
    <div className="flex items-center justify-between gap-2">
      <span id={`${ids}-label`} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" aria-label="Saving" />}
      </span>
      {aside && <span className="relative z-10">{aside}</span>}
    </div>
  )

  if (canEdit && editing) {
    return (
      <div className="space-y-1">
        {labelRow}
        {renderEditor({ value, commit, cancel: () => onEditingChange(false) })}
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div className="min-w-0 space-y-0.5">
        {labelRow}
        <div className="break-words text-sm text-foreground">{renderValue(shown)}</div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group relative -mx-2 min-w-0 space-y-0.5 rounded-md border border-transparent px-2 py-1.5 transition-colors duration-100",
        saving ? "cursor-progress" : "cursor-pointer hover:border-border hover:bg-surface-hover focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
      )}
    >
      {labelRow}
      <button
        ref={buttonRef}
        type="button"
        disabled={saving}
        onClick={() => onEditingChange(true)}
        aria-labelledby={`${ids}-label ${ids}-value`}
        aria-describedby={`${ids}-hint`}
        // Covers the whole field, so the label is part of the target too
        className="block w-full text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none disabled:cursor-progress"
      >
        <span id={`${ids}-value`} className="block break-words pr-12 text-sm text-foreground">
          {renderValue(shown)}
        </span>
      </button>
      <span
        id={`${ids}-hint`}
        className="pointer-events-none absolute right-2 top-1.5 flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Pencil size={11} aria-hidden="true" />
        Edit
      </span>
    </div>
  )
}

const EDITOR =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export interface InlineOption {
  value: string
  label: string
}

// A select editor: choosing a value with the pointer saves it. Some browsers
// change a closed select's value on each arrow key, so a value picked with
// the keyboard waits for Enter (or leaving the field) instead of saving on
// the first arrow press. Escape cancels; leaving it unchanged cancels.
export function InlineSelect({
  value,
  options,
  groups,
  commit,
  cancel,
  ariaLabel,
}: {
  value: string
  options?: readonly InlineOption[]
  groups?: readonly { label: string; options: readonly InlineOption[] }[]
  commit: (next: string) => void
  cancel: () => void
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(value)
  const byKeyboard = useRef(false)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    if (next === null || next === value) cancel()
    else commit(next)
  }
  return (
    <select
      autoFocus
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        if (!byKeyboard.current) finish(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          finish(null)
        } else if (e.key === "Enter") {
          e.preventDefault()
          finish(draft)
        } else if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key.length === 1) {
          byKeyboard.current = true
        }
      }}
      onPointerDown={() => {
        byKeyboard.current = false
      }}
      onBlur={() => finish(draft)}
      className={EDITOR}
    >
      {options?.map((o) => (
        <option key={o.value || "none"} value={o.value}>
          {o.label}
        </option>
      ))}
      {groups?.map((g) =>
        g.options.length === 0 ? null : (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )
      )}
    </select>
  )
}

// A text or date editor: Enter saves, Escape cancels, and leaving it saves
// a changed value or cancels an unchanged one
export function InlineInput({
  value,
  commit,
  cancel,
  ariaLabel,
  type = "text",
  inputMode,
  placeholder,
  prefix,
}: {
  value: string
  commit: (next: string) => void
  cancel: () => void
  ariaLabel: string
  type?: "text" | "date"
  inputMode?: "decimal" | "text"
  placeholder?: string
  prefix?: string
}) {
  const [text, setText] = useState(value)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save && text.trim() !== value) commit(text.trim())
    else cancel()
  }
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
      <input
        autoFocus
        aria-label={ariaLabel}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            finish(true)
          } else if (e.key === "Escape") {
            e.preventDefault()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
        className={cn(EDITOR, prefix && "pl-6", inputMode === "decimal" && "tabular-nums")}
      />
    </div>
  )
}
