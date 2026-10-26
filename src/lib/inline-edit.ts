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
