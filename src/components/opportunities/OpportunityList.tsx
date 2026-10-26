"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { ColumnFilterRow, ColumnFilterToggle, useColumnFilters } from "@/components/table/ColumnFilters"
import { filterRowsByColumns, type FilterableColumn } from "@/lib/column-filters"
import {
  contactName,
  formatCents,
  formatDate,
  formatDateOnly,
  valueCents,
  type OpportunityRow,
  type StageOption,
} from "@/lib/opportunity-view"
import { StagePill } from "./StagePill"

type SortColumn = "number" | "title" | "client" | "contact" | "owner" | "stage" | "type" | "value" | "expectedClose" | "updated"
type SortDirection = "asc" | "desc" | null

// The text each column shows, which its column filter also matches
// ("Unassigned" for no owner, dates and values as displayed)
const valueText = (o: OpportunityRow) => (o.expectedValue === null ? "-" : formatCents(valueCents(o.expectedValue)))

// Fixed widths: below their total the table scrolls sideways, and long
// text truncates with the full value in a tooltip. Never squeezed. The key
// is also the column filter's URL parameter (f_<key>).
export const OPPORTUNITY_LIST_COLUMNS: (FilterableColumn<OpportunityRow> & { key: SortColumn; label: string; width: number; align?: "right" })[] = [
  { key: "number", label: "Number", width: 150, text: (o) => o.number },
  { key: "title", label: "Title", width: 260, text: (o) => o.title },
  { key: "client", label: "Client", width: 190, text: (o) => o.client.name },
  { key: "contact", label: "Contact", width: 170, text: (o) => contactName(o.contact) },
  { key: "owner", label: "Owner", width: 150, text: (o) => o.owner?.name ?? "Unassigned" },
  { key: "stage", label: "Stage", width: 160, text: (o) => o.stage.name },
  { key: "type", label: "Type", width: 150, text: (o) => o.type?.name ?? "-" },
  { key: "value", label: "Value", width: 140, align: "right", text: valueText },
  { key: "expectedClose", label: "Expected close", width: 140, text: (o) => formatDateOnly(o.expectedCloseDate) },
  { key: "updated", label: "Updated", width: 120, text: (o) => formatDate(o.updatedAt) },
]
export const OPPORTUNITY_FILTER_KEYS = OPPORTUNITY_LIST_COLUMNS.map((c) => c.key)

// The column at the start holding the filter icon
const TOGGLE_WIDTH = 44
const TABLE_MIN_WIDTH = TOGGLE_WIDTH + OPPORTUNITY_LIST_COLUMNS.reduce((sum, c) => sum + c.width, 0)
const FILTER_ROW_ID = "opportunity-column-filters"

const time = (value: string | null) => (value ? Date.parse(value) : 0)

function compare(a: OpportunityRow, b: OpportunityRow, column: SortColumn, stageOrder: Map<string, number>): number {
  switch (column) {
    case "number":
      return a.number.localeCompare(b.number, undefined, { numeric: true })
    case "title":
      return a.title.localeCompare(b.title)
    case "client":
      return a.client.name.localeCompare(b.client.name)
    case "contact":
      return contactName(a.contact).localeCompare(contactName(b.contact))
    case "owner":
      return (a.owner?.name ?? "").localeCompare(b.owner?.name ?? "")
    case "stage":
      return (stageOrder.get(a.stage.id) ?? 0) - (stageOrder.get(b.stage.id) ?? 0)
    case "type":
      return (a.type?.name ?? "").localeCompare(b.type?.name ?? "")
    case "value":
      return valueCents(a.expectedValue) - valueCents(b.expectedValue)
    case "expectedClose":
      return time(a.expectedCloseDate) - time(b.expectedCloseDate)
    case "updated":
      return time(a.updatedAt) - time(b.updatedAt)
  }
}

function SortableHeader({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  align,
}: {
  label: string
  column: SortColumn
  sortColumn: SortColumn | null
  sortDirection: SortDirection
  onSort: (column: SortColumn) => void
  align?: "right"
}) {
  const active = sortColumn === column
  return (
    <th
      scope="col"
      aria-sort={active && sortDirection ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
      className={`select-none py-2 pr-3 ${align === "right" ? "text-right" : ""}`}
    >
      <button onClick={() => onSort(column)} className={`flex items-center gap-1 hover:text-foreground ${align === "right" ? "ml-auto" : ""}`}>
        {label}
        {active && sortDirection === "asc" && <ArrowUp size={12} />}
        {active && sortDirection === "desc" && <ArrowDown size={12} />}
        {!active && <ArrowUpDown size={12} className="opacity-30" />}
      </button>
    </th>
  )
}

export function OpportunityList({ opportunities, stages }: { opportunities: OpportunityRow[]; stages: StageOption[] }) {
  const router = useRouter()
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const columnFilters = useColumnFilters(OPPORTUNITY_FILTER_KEYS)

  // Ascending, then descending, then back to the API's order (newest first)
  function handleSort(column: SortColumn) {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDirection("asc")
    } else if (sortDirection === "asc") {
      setSortDirection("desc")
    } else {
      setSortColumn(null)
      setSortDirection(null)
    }
  }

  // Column filters run on the rows already loaded (the list isn't paged);
  // they move to the server when the list is paged
  const filtered = filterRowsByColumns(opportunities, columnFilters.filters, OPPORTUNITY_LIST_COLUMNS)
  const stageOrder = new Map(stages.map((s, i) => [s.id, i]))
  const sorted =
    sortColumn && sortDirection
      ? [...filtered].sort((a, b) => {
          const cmp = compare(a, b, sortColumn, stageOrder)
          return sortDirection === "asc" ? cmp : -cmp
        })
      : filtered

  const cell = "py-3 pr-3 truncate"
  const cells: Record<SortColumn, (o: OpportunityRow, href: string) => ReactNode> = {
    number: (o, href) => (
      <Link href={href} className="text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {o.number}
      </Link>
    ),
    title: (o) => o.title,
    client: (o) => o.client.name,
    contact: (o) => contactName(o.contact),
    owner: (o) => o.owner?.name ?? "Unassigned",
    stage: (o) => <StagePill name={o.stage.name} category={o.stage.category} />,
    type: (o) => o.type?.name ?? "-",
    value: valueText,
    expectedClose: (o) => formatDateOnly(o.expectedCloseDate),
    updated: (o) => formatDate(o.updatedAt),
  }
  const cellClass: Partial<Record<SortColumn, string>> = {
    number: "font-medium tabular-nums",
    title: "text-foreground",
    client: "text-foreground",
    contact: "text-muted-foreground",
    owner: "text-muted-foreground",
    type: "text-muted-foreground",
    value: "text-right font-medium tabular-nums text-foreground",
    expectedClose: "text-muted-foreground",
    updated: "text-muted-foreground",
  }

  return (
    <div className="space-y-2">
      {columnFilters.active && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            Showing {filtered.length} of {opportunities.length}
          </span>
          <button type="button" onClick={columnFilters.clear} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Clear filters
          </button>
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <colgroup>
            <col style={{ width: TOGGLE_WIDTH }} />
            {OPPORTUNITY_LIST_COLUMNS.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <th scope="col" className="py-1 pl-2">
                <ColumnFilterToggle
                  open={columnFilters.open}
                  active={columnFilters.active}
                  onToggle={() => columnFilters.setOpen(!columnFilters.open)}
                  rowId={FILTER_ROW_ID}
                />
              </th>
              {OPPORTUNITY_LIST_COLUMNS.map((c) => (
                <SortableHeader
                  key={c.key}
                  label={c.label}
                  column={c.key}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  align={c.align}
                />
              ))}
            </tr>
            {columnFilters.open && (
              <ColumnFilterRow
                id={FILTER_ROW_ID}
                columns={OPPORTUNITY_LIST_COLUMNS}
                filters={columnFilters.filters}
                onChange={columnFilters.setFilter}
                leadingCells={1}
              />
            )}
          </thead>
          <tbody>
            {sorted.map((o) => {
              const href = `/dashboard/opportunities/${o.id}`
              return (
                <tr
                  key={o.id}
                  onClick={(e) => {
                    // The number is a real link; anywhere else on the row opens it too
                    if ((e.target as HTMLElement).closest("a")) return
                    router.push(href)
                  }}
                  className="cursor-pointer border-b border-border transition-colors hover:bg-surface-hover"
                >
                  <td aria-hidden="true" />
                  {OPPORTUNITY_LIST_COLUMNS.map((c) => (
                    <td key={c.key} className={`${cell} ${cellClass[c.key] ?? ""}`} title={c.key === "stage" || c.key === "number" ? undefined : c.text(o)}>
                      {cells[c.key](o, href)}
                    </td>
                  ))}
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={OPPORTUNITY_LIST_COLUMNS.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                  No opportunities match these column filters.{" "}
                  <button type="button" onClick={columnFilters.clear} className="font-medium text-primary hover:underline">
                    Clear filters
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
