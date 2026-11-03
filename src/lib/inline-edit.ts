// How a field edited in place (InlineEditField, src/components/inline-edit/)
// saves. No React and no database imports, so the rule can be checked on its
// own.

export type InlineEditOutcome = "unchanged" | "saved" | "reverted"

// Same value, compared by content (ids, text, or small objects)
export function sameInlineValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

// Saves an edited value: nothing when it didn't change; otherwise the new
// value shows (pending, with a spinner) while save runs, and when save
// fails (it shows its own error toast and returns false, or throws) the
// pending value is dropped so the field shows the old value again.
export async function commitInlineEdit<T>(opts: {
  current: T
  next: T
  save: (value: T) => Promise<boolean>
  setPending: (pending: { value: T } | null) => void
}): Promise<InlineEditOutcome> {
  if (sameInlineValue(opts.current, opts.next)) return "unchanged"
  opts.setPending({ value: opts.next })
  let ok = false
  try {
    ok = await opts.save(opts.next)
  } catch {
    ok = false
  }
  opts.setPending(null)
  return ok ? "saved" : "reverted"
}

// ─── Listbox editor ─────────────────────────────────────────────────────────
// The list InlineListbox shows: open as soon as the field is clicked, the
// current value highlighted. Arrow keys, Home, and End only move the
// highlight; Enter or a click chooses. Options may carry a group heading
// (shown once, above the first option of each group).

export interface ListboxOption {
  value: string
  label: string
  group?: string
}

// Options whose label holds the typed text, ignoring case, in their order
export function filterListboxOptions<T extends ListboxOption>(options: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : [...options]
}

// Where a key moves the highlight in a list of count options. Unknown keys
// leave it where it is. Never wraps, so holding a key stops at the end.
export function moveListboxIndex(index: number, key: string, count: number): number {
  if (count === 0) return 0
  if (key === "ArrowDown") return Math.min(index + 1, count - 1)
  if (key === "ArrowUp") return Math.max(index - 1, 0)
  if (key === "Home") return 0
  if (key === "End") return count - 1
  return Math.min(Math.max(index, 0), count - 1)
}

// The option highlighted when the list opens: the current value, else the first
export function initialListboxIndex(options: readonly ListboxOption[], value: string): number {
  const index = options.findIndex((o) => o.value === value)
  return index < 0 ? 0 : index
}
