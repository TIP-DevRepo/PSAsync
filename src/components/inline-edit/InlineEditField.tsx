"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { Check, Loader2, Pencil } from "lucide-react"
import {
  commitInlineEdit,
  filterListboxOptions,
  initialListboxIndex,
  moveListboxIndex,
  type ListboxOption,
} from "@/lib/inline-edit"
import { cn } from "@/lib/utils"

// One field of a HaloPSA style details panel: the label above, the value
// below. Editable, hovering or keyboard focus outlines it with a small Edit
// hint, and one click (or Enter) turns it into its editor in place, with
// focus already in the editor. The parent decides which field is editing
// (only one at a time) and how a value saves; save shows its own error toast
// and returns false on a failure, which puts the old value back
// (commitInlineEdit). Read only (no edit permission), it shows plainly with
// no outline. Shared so tickets can use the same panel style.
//
// The edit target is a button laid over the whole field, under the value. A
// link in the value (InlineFieldLink) sits above it, so clicking the link
// only follows the link, clicking anywhere else edits, and Tab reaches the
// field and the link separately.
export function InlineEditField<T>({
  label,
  value,
  renderValue,
  canEdit,
  editing,
  onEditingChange,
  onSave,
  renderEditor,
  busy = false,
}: {
  label: string
  value: T
  // How a value shows, also used for the new value while it saves. May hold
  // an InlineFieldLink.
  renderValue: (value: T) => ReactNode
  canEdit: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSave: (value: T) => Promise<boolean>
  // The editor, given the current value, commit (save a value) and cancel
  renderEditor: (editor: { value: T; commit: (next: T) => void; cancel: () => void }) => ReactNode
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

  const editable = canEdit && !editing
  // The Edit hint has its own place in the label row, so it can never sit on
  // the value or a link at any width
  const labelRow = (
    <div className="flex items-start justify-between gap-2">
      <span id={`${ids}-label`} className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {saving && <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" aria-label="Saving" />}
      </span>
      {editable && (
        <span
          id={`${ids}-hint`}
          className="pointer-events-none flex shrink-0 items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-has-[>button:focus-visible]:opacity-100"
        >
          <Pencil size={11} aria-hidden="true" />
          Edit
        </span>
      )}
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
        saving
          ? "cursor-progress"
          : "cursor-pointer hover:border-border hover:bg-surface-hover has-[>button:focus-visible]:border-ring has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-ring/40"
      )}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={saving}
        onClick={() => onEditingChange(true)}
        aria-labelledby={`${ids}-label ${ids}-value`}
        aria-describedby={`${ids}-hint`}
        // Covers the whole field (label and value), under any link in the value
        className="absolute inset-0 h-full w-full rounded-md focus-visible:outline-none disabled:cursor-progress"
      />
      {labelRow}
      <div id={`${ids}-value`} className="break-words text-sm text-foreground">
        {renderValue(shown)}
      </div>
    </div>
  )
}

// A name in a field's value that opens its page in a new browser tab. It
// sits above the field's edit target, so clicking it never opens the editor.
export function InlineFieldLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="relative z-10 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </a>
  )
}

const EDITOR =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

// A list editor in place of a native select, whose options a page can't
// open in every browser: it is open the moment the field is clicked, with
// focus in it (in its search box when the list is long). Arrow keys, Home,
// and End only move the highlight; Enter or a click saves; Escape, Tab, or
// clicking away cancels.
export function InlineListbox({
  value,
  options,
  commit,
  cancel,
  ariaLabel,
  searchable = options.length > 7,
}: {
  value: string
  options: readonly ListboxOption[]
  commit: (next: string) => void
  cancel: () => void
  ariaLabel: string
  searchable?: boolean
}) {
  const ids = useId()
  const [query, setQuery] = useState("")
  const shown = filterListboxOptions(options, query)
  const [active, setActive] = useState(() => initialListboxIndex(options, value))
  const activeIndex = moveListboxIndex(active, "", shown.length)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const done = useRef(false)

  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    if (next === null) cancel()
    else commit(next)
  }

  useEffect(() => {
    focusRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      finish(null)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (shown[activeIndex]) finish(shown[activeIndex].value)
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault()
      setActive(moveListboxIndex(activeIndex, e.key, shown.length))
    }
  }

  const listId = `${ids}-list`
  const optionId = (i: number) => `${ids}-option-${i}`
  const activeId = shown[activeIndex] ? optionId(activeIndex) : undefined

  return (
    <div
      ref={containerRef}
      onBlur={(e) => {
        // Clicking away (focus leaving the editor) cancels
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) finish(null)
      }}
      className="space-y-1"
    >
      {searchable && (
        <input
          ref={(el) => {
            focusRef.current = el
          }}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder="Search"
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className={EDITOR}
        />
      )}
      <ul
        ref={(el) => {
          listRef.current = el
          if (!searchable) focusRef.current = el
        }}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={searchable ? -1 : 0}
        aria-activedescendant={searchable ? undefined : activeId}
        onKeyDown={searchable ? undefined : onKeyDown}
        className="max-h-64 overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No matches.</li>}
        {shown.map((o, i) => (
          <ListboxRow
            key={`${o.group ?? ""}-${o.value || "none"}`}
            option={o}
            heading={o.group && o.group !== shown[i - 1]?.group ? o.group : null}
            id={optionId(i)}
            index={i}
            active={i === activeIndex}
            selected={o.value === value}
            onHover={() => setActive(i)}
            onChoose={() => finish(o.value)}
          />
        ))}
      </ul>
    </div>
  )
}

function ListboxRow({
  option,
  heading,
  id,
  index,
  active,
  selected,
  onHover,
  onChoose,
}: {
  option: ListboxOption
  heading: string | null
  id: string
  index: number
  active: boolean
  selected: boolean
  onHover: () => void
  onChoose: () => void
}) {
  return (
    <>
      {heading && (
        <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
        </li>
      )}
      <li
        id={id}
        data-index={index}
        role="option"
        aria-selected={selected}
        // Keeps focus in the editor, so choosing isn't seen as clicking away
        onMouseDown={(e) => e.preventDefault()}
        onClick={onChoose}
        onMouseEnter={onHover}
        className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-foreground", active && "bg-surface-hover")}
      >
        <span className="min-w-0 break-words">{option.label}</span>
        {selected && <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />}
      </li>
    </>
  )
}

// A text or date editor, focused with its text selected: Enter saves,
// Escape cancels, and leaving it saves a changed value or cancels an
// unchanged one
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
        onFocus={(e) => {
          // A date input has no text to select in some browsers
          try {
            e.currentTarget.select()
          } catch {
            // nothing to select
          }
        }}
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
