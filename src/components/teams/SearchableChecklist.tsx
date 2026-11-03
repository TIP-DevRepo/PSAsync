"use client"

import { useId, useState, type ReactNode } from "react"
import { Search } from "lucide-react"

export interface ChecklistOption {
  value: string
  label: ReactNode
  // What the search box matches against (case insensitive)
  searchText: string
  // Set when the option can't be changed, shown under it
  disabledReason?: string | null
}

// Show the search box once the list is longer than this
const SEARCH_AFTER = 7

// A labelled list of checkboxes in a fixed height scroll box, with a search
// box for long lists. Used for a team's members and default roles, and a
// user's teams. Options keep the order given (callers sort users with the
// shared user picker helper). Disabled options stay listed with their
// reason, the same way the role checklist shows roles out of reach.
export function SearchableChecklist({
  label,
  description,
  options,
  selected,
  onChange,
  disabled = false,
  emptyText,
  searchLabel,
}: {
  label: string
  description?: ReactNode
  options: ChecklistOption[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  emptyText: string
  searchLabel: string
}) {
  const id = useId()
  const [query, setQuery] = useState("")
  const selectedSet = new Set(selected)
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.searchText.toLowerCase().includes(q)) : options

  function toggle(value: string, checked: boolean) {
    onChange(checked ? [...selected, value] : selected.filter((v) => v !== value))
  }

  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-foreground">
        {label} <span className="font-normal text-muted-foreground">({selected.length} selected)</span>
      </legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {options.length > SEARCH_AFTER && (
        <div className="relative">
          <label htmlFor={`${id}-search`} className="sr-only">
            {searchLabel}
          </label>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchLabel}
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{options.length === 0 ? emptyText : "Nothing matches this search."}</p>
        ) : (
          <ul>
            {shown.map((option) => {
              const reason = option.disabledReason ?? null
              return (
                <li key={option.value}>
                  <label
                    className={`flex items-start gap-2 px-3 py-2 text-sm ${reason ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-surface-hover"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedSet.has(option.value)}
                      disabled={!!reason}
                      onChange={(e) => toggle(option.value, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-foreground">{option.label}</span>
                      {reason && <span className="mt-0.5 block text-caption text-muted-foreground">{reason}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </fieldset>
  )
}
