"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ListFilter } from "lucide-react"
import { cn } from "@/lib/utils"
import { COLUMN_FILTER_MAX, hasColumnFilters, readColumnFilters, writeColumnFilters, type ColumnFilters } from "@/lib/column-filters"

// HaloPSA style column filters for a list table (rules in
// src/lib/column-filters.ts). A table puts ColumnFilterToggle in its header
// row and ColumnFilterRow right under the column names; useColumnFilters
// keeps the filters in the URL. Shared by the opportunities list and,
// later, the tickets list.

// The filters for a list's columns: what the boxes hold (applied to the
// rows as the user types) and whether the filter row is open. The URL
// follows after a short pause in typing, and a URL change (back, forward, a
// link) is followed. The row opens by itself when the URL has a filter.
export function useColumnFilters(keys: readonly string[]) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const keyList = keys.join(",")
  const fromUrl = readColumnFilters(searchParams, keys)
  const urlKey = filterKey(fromUrl, keys)

  const [filters, setFilters] = useState<ColumnFilters>(fromUrl)
  const [open, setOpen] = useState(hasColumnFilters(fromUrl))
  const [seenUrlKey, setSeenUrlKey] = useState(urlKey)
  // The filters this hook last wrote into the URL, so the URL catching up
  // with them never replaces newer typing
  const [writtenKey, setWrittenKey] = useState(urlKey)
  if (urlKey !== seenUrlKey) {
    setSeenUrlKey(urlKey)
    if (urlKey !== writtenKey && urlKey !== filterKey(filters, keys)) {
      setFilters(fromUrl)
      if (hasColumnFilters(fromUrl)) setOpen(true)
    }
  }

  // Writes the boxes into the URL once typing pauses
  const current = searchParams.toString()
  const wanted = writeColumnFilters(current, filters, keyList.split(","))
  const wantedKey = filterKey(filters, keyList.split(","))
  useEffect(() => {
    if (wanted === current) return
    const timer = setTimeout(() => {
      setWrittenKey(wantedKey)
      router.replace(wanted ? `${pathname}?${wanted}` : pathname, { scroll: false })
    }, 250)
    return () => clearTimeout(timer)
  }, [wanted, wantedKey, current, pathname, router])

  return {
    filters,
    open,
    active: hasColumnFilters(filters),
    setOpen,
    setFilter: (key: string, value: string) => setFilters((prev) => ({ ...prev, [key]: value.slice(0, COLUMN_FILTER_MAX) })),
    clear: () => setFilters({}),
  }
}

// The filters as one comparable string, in the columns' order
function filterKey(filters: ColumnFilters, keys: readonly string[]): string {
  return JSON.stringify(keys.map((k) => (filters[k] ?? "").trim()))
}

// The filter icon for a table's header row. A dot marks it while any
// column filter has text.
export function ColumnFilterToggle({ open, active, onToggle, rowId }: { open: boolean; active: boolean; onToggle: () => void; rowId: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-expanded={open}
      aria-controls={rowId}
      aria-label={active ? "Column filters (some are on)" : "Column filters"}
      title="Column filters"
      className={cn(
        "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        (open || active) && "text-primary"
      )}
    >
      <ListFilter size={15} aria-hidden="true" />
      {active && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
    </button>
  )
}

// The row of text boxes under the column names, one per column, each as
// wide as its column (the table's own fixed widths), scrolling sideways
// with the table. leadingCells are the cells before the first column (the
// toggle's column).
export function ColumnFilterRow({
  id,
  columns,
  filters,
  onChange,
  leadingCells = 0,
  cellClassName,
}: {
  id: string
  columns: readonly { key: string; label: string }[]
  filters: ColumnFilters
  onChange: (key: string, value: string) => void
  leadingCells?: number
  cellClassName?: string
}) {
  return (
    <tr id={id} className="border-b border-border bg-card">
      {Array.from({ length: leadingCells }, (_, i) => (
        <th key={`lead-${i}`} aria-hidden="true" />
      ))}
      {columns.map((column) => (
        <th key={column.key} scope="col" className={cn("py-1.5 pr-3 font-normal", cellClassName)}>
          <input
            type="search"
            value={filters[column.key] ?? ""}
            onChange={(e) => onChange(column.key, e.target.value)}
            maxLength={COLUMN_FILTER_MAX}
            aria-label={`Filter ${column.label}`}
            placeholder="Filter"
            className="w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </th>
      ))}
    </tr>
  )
}
