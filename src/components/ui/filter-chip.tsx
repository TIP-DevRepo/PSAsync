"use client"

import { X } from "lucide-react"

// An active scope filter next to a list's search (a team, an owner or
// assignee), removed with its X. Shared by the Opportunities and Tickets
// lists.
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-acc-tint py-1 pl-3 pr-1 text-[13px] font-semibold text-acc-ink">
      <span className="truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-acc-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  )
}
