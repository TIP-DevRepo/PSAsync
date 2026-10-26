"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { FILTER_SEARCH_MAX } from "@/lib/opportunity-view"

const FIELD =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

// The search box both views share (title, number, or client, searched by
// the API). The list's other filters are its column filters. The URL
// follows once typing pauses.
export function OpportunityFilterBar({ q, onChange }: { q: string; onChange: (q: string) => void }) {
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

  return (
    <div className="relative w-full sm:w-80">
      <label htmlFor="opportunity-search" className="mb-1 block text-xs font-medium text-muted-foreground">
        Search
      </label>
      <Search size={14} className="pointer-events-none absolute left-3 top-[34px] text-muted-foreground" aria-hidden="true" />
      <input
        id="opportunity-search"
        type="search"
        value={searchText}
        maxLength={FILTER_SEARCH_MAX}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Search by title, number, or client"
        className={`${FIELD} w-full pl-8`}
      />
    </div>
  )
}
