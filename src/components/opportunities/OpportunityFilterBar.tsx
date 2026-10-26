"use client"

import { useEffect, useState } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  EMPTY_FILTERS,
  FILTER_SEARCH_MAX,
  hasActiveFilters,
  type OpportunityFilters,
  type OwnerChoice,
  type TypeOption,
} from "@/lib/opportunity-view"

const FIELD =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

// The filter bar both views share. Every change goes straight to the URL
// (onChange); the search text waits until typing pauses.
export function OpportunityFilterBar({
  filters,
  onChange,
  ownerChoices,
  clients,
  types,
}: {
  filters: OpportunityFilters
  onChange: (filters: OpportunityFilters) => void
  ownerChoices: OwnerChoice[]
  clients: { id: string; name: string }[]
  types: TypeOption[]
}) {
  const [searchText, setSearchText] = useState(filters.q)

  // Follows the URL when it changes some other way (Clear filters, back)
  const [urlQ, setUrlQ] = useState(filters.q)
  if (urlQ !== filters.q) {
    setUrlQ(filters.q)
    if (searchText.trim() !== filters.q) setSearchText(filters.q)
  }

  useEffect(() => {
    const q = searchText.trim()
    if (q === filters.q) return
    const timer = setTimeout(() => onChange({ ...filters, q }), 300)
    return () => clearTimeout(timer)
  }, [searchText, filters, onChange])

  const set = (key: keyof OpportunityFilters, value: string) => onChange({ ...filters, [key]: value })

  // An owner, client, or type in the URL that isn't in the lists (yet, or
  // any more) still shows as chosen instead of a blank select
  const ownerKnown = !filters.owner || ownerChoices.some((c) => c.value === filters.owner)
  const clientKnown = !filters.client || clients.some((c) => c.id === filters.client)
  const typeKnown = !filters.type || types.some((t) => t.id === filters.type)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative w-full sm:w-72">
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

      <div className="w-full sm:w-44">
        <label htmlFor="opportunity-owner" className="mb-1 block text-xs font-medium text-muted-foreground">
          Owner
        </label>
        <select id="opportunity-owner" value={filters.owner} onChange={(e) => set("owner", e.target.value)} className={`${FIELD} w-full`}>
          {ownerChoices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
          {!ownerKnown && <option value={filters.owner}>Selected user</option>}
        </select>
      </div>

      <div className="w-full sm:w-52">
        <label htmlFor="opportunity-client" className="mb-1 block text-xs font-medium text-muted-foreground">
          Client
        </label>
        <select id="opportunity-client" value={filters.client} onChange={(e) => set("client", e.target.value)} className={`${FIELD} w-full`}>
          <option value="">Any client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {!clientKnown && <option value={filters.client}>Selected client</option>}
        </select>
      </div>

      <div className="w-full sm:w-44">
        <label htmlFor="opportunity-type" className="mb-1 block text-xs font-medium text-muted-foreground">
          Type
        </label>
        <select id="opportunity-type" value={filters.type} onChange={(e) => set("type", e.target.value)} className={`${FIELD} w-full`}>
          <option value="">Any type</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {!typeKnown && <option value={filters.type}>Selected type</option>}
        </select>
      </div>

      <fieldset className="w-full sm:w-auto">
        <legend className="mb-1 block text-xs font-medium text-muted-foreground">Expected close</legend>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Expected close from"
            value={filters.closeFrom}
            max={filters.closeTo || undefined}
            onChange={(e) => set("closeFrom", e.target.value)}
            className={`${FIELD} min-w-0 flex-1 sm:w-40 sm:flex-none`}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            aria-label="Expected close to"
            value={filters.closeTo}
            min={filters.closeFrom || undefined}
            onChange={(e) => set("closeTo", e.target.value)}
            className={`${FIELD} min-w-0 flex-1 sm:w-40 sm:flex-none`}
          />
        </div>
      </fieldset>

      {hasActiveFilters(filters) && (
        <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)} className="gap-1">
          <X size={14} aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  )
}
