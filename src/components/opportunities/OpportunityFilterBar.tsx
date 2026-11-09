"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { FILTER_SEARCH_MAX } from "@/lib/opportunity-view"

// The search box both views share (title, number, or client, searched by
// the API). The list's other filters are its column filters. The URL
// follows once typing pauses. The Tickets list uses it too, with its own
// label and id.
export function OpportunityFilterBar({
  q,
  onChange,
  label = "Search opportunities",
  id = "opportunity-search",
}: {
  q: string
  onChange: (q: string) => void
  label?: string
  id?: string
}) {
  const [searchText, setSearchText] = useState(q)

  // Follows the URL when it changes some other way (Clear filters, back)
  const [urlQ, setUrlQ] = useState(q)
  if (urlQ !== q) {
    setUrlQ(q)
    if (searchText.trim() !== q) setSearchText(q)
  }

  useEffect(() => {
    const next = searchText.trim()
    if (next === q) return
    const timer = setTimeout(() => onChange(next), 300)
    return () => clearTimeout(timer)
  }, [searchText, q, onChange])

  // The design's toolbar search: the icon inside a bordered box, the label
  // for screen readers
  return (
    <label className="flex w-full min-w-0 items-center gap-2 rounded-control border border-border bg-card px-2.5 py-[7px] text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-[260px]">
      <Search size={16} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="search"
        value={searchText}
        maxLength={FILTER_SEARCH_MAX}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Search by title, number, or client"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </label>
  )
}
