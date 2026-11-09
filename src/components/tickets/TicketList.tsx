"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { ColumnFilterRow, ColumnFilterToggle } from "@/components/table/ColumnFilters"
import { useRowDensity } from "@/components/AppearanceProvider"
import { InitialsAvatar, TABLE } from "@/components/ui/blocks"
import { useAccess } from "@/components/AccessProvider"
import { cn } from "@/lib/utils"
import type { ColumnFilters } from "@/lib/column-filters"
import type { SortDirection, TicketColumnKey } from "@/lib/ticket-list"
import { relativeTime, ticketHref, type TicketRow } from "@/lib/ticket-view"
import { TicketPriorityMarker, TicketStatusPill } from "./TicketPills"

// The columns as the design draws the Tickets list, with fixed widths:
// below their total the table scrolls sideways, never squeezed. Each key is
// its sort key and its column filter's URL parameter (f_<key>); Updated has
// no filter box.
export const TICKET_LIST_COLUMNS: { key: TicketColumnKey; label: string; width: number; filterable?: false }[] = [
  { key: "number", label: "Ticket", width: 140 },
  { key: "subject", label: "Subject", width: 340 },
  { key: "status", label: "Status", width: 180 },
  { key: "priority", label: "Priority", width: 130 },
  { key: "queue", label: "Queue", width: 160 },
  { key: "assignee", label: "Assignee", width: 200 },
  { key: "updated", label: "Updated", width: 130, filterable: false },
]

// The column at the start holding the filter icon
const TOGGLE_WIDTH = 44
const TABLE_MIN_WIDTH = TOGGLE_WIDTH + TICKET_LIST_COLUMNS.reduce((sum, c) => sum + c.width, 0)

export interface TicketColumnFilterState {
  filters: ColumnFilters
  open: boolean
  active: boolean
  setOpen: (open: boolean) => void
  setFilter: (key: string, value: string) => void
}

// One page of tickets. Sorting and the column filters (server mode) run in
// the database: a header click asks the page to sort (ascending, then
// descending, then back to newest first), and the boxes write the URL the
// page's request follows. The number is a real link; a click anywhere else
// on the row opens the ticket too.
export function TicketList({
  tickets,
  sort,
  dir,
  onSort,
  columnFilters,
  filterRowId,
  priorityOrders,
  loading,
  emptyMessage,
}: {
  tickets: TicketRow[]
  sort: TicketColumnKey | ""
  dir: SortDirection
  onSort: (column: TicketColumnKey) => void
  columnFilters: TicketColumnFilterState
  filterRowId: string
  // Every priority's sortOrder, for the markers' tones
  priorityOrders: readonly number[]
  loading: boolean
  emptyMessage: ReactNode
}) {
  const router = useRouter()
  const myUserId = useAccess().access?.userId ?? null
  const density = useRowDensity()
  const cell = `${density === "compact" ? "py-1.5" : density === "comfortable" ? "py-5" : "py-3"} ${TABLE.cellX}`
  const now = new Date()

  const cells: Record<TicketColumnKey, (t: TicketRow) => ReactNode> = {
    number: (t) => (
      <Link href={ticketHref(t.id)} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t.number}
      </Link>
    ),
    subject: (t) => (
      <>
        <span className="block truncate font-medium text-foreground" title={t.title}>
          {t.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground" title={t.client?.name ?? "No client"}>
          {t.client?.name ?? "No client"}
        </span>
      </>
    ),
    status: (t) => <TicketStatusPill name={t.status.name} category={t.status.category} />,
    priority: (t) => <TicketPriorityMarker name={t.priority.name} sortOrder={t.priority.sortOrder} allOrders={priorityOrders} />,
    queue: (t) => (
      <span className="block truncate" title={t.team.name}>
        {t.team.name}
      </span>
    ),
    assignee: (t) => (
      <span className="flex min-w-0 items-center gap-2 text-[13px]">
        <InitialsAvatar name={t.assignee?.name ?? null} tone={t.assignee ? (t.assignee.id === myUserId ? "solid" : "accent") : "neutral"} size="sm" />
        <span className={cn("truncate", t.assignee ? "text-foreground" : "text-muted-foreground")} title={t.assignee?.name ?? "Unassigned"}>
          {t.assignee?.name ?? "Unassigned"}
        </span>
      </span>
    ),
    updated: (t) => (
      <time dateTime={t.updatedAt} title={new Date(t.updatedAt).toLocaleString()}>
        {relativeTime(t.updatedAt, now)}
      </time>
    ),
  }
  const cellClass: Partial<Record<TicketColumnKey, string>> = {
    number: TABLE.number,
    queue: "text-[13px] text-muted-foreground",
    updated: "text-[13px] text-muted-foreground",
  }

  return (
    // Fixed widths: below them the table scrolls sideways, never squeezed
    <div className={TABLE.scroll}>
      <table className={TABLE.table} style={{ minWidth: TABLE_MIN_WIDTH }} aria-busy={loading}>
        <colgroup>
          <col style={{ width: TOGGLE_WIDTH }} />
          {TICKET_LIST_COLUMNS.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className={TABLE.headRow}>
            <th scope="col" className="py-1 pl-2">
              <ColumnFilterToggle open={columnFilters.open} active={columnFilters.active} onToggle={() => columnFilters.setOpen(!columnFilters.open)} rowId={filterRowId} />
            </th>
            {TICKET_LIST_COLUMNS.map((c) => {
              const active = sort === c.key
              return (
                <th key={c.key} scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={cn("select-none", TABLE.th)}>
                  <button type="button" onClick={() => onSort(c.key)} className="flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.label}
                    {active && dir === "asc" && <ArrowUp size={12} aria-hidden="true" />}
                    {active && dir === "desc" && <ArrowDown size={12} aria-hidden="true" />}
                    {!active && <ArrowUpDown size={12} className="opacity-30" aria-hidden="true" />}
                  </button>
                </th>
              )
            })}
          </tr>
          {columnFilters.open && (
            <ColumnFilterRow id={filterRowId} columns={TICKET_LIST_COLUMNS} filters={columnFilters.filters} onChange={columnFilters.setFilter} leadingCells={1} />
          )}
        </thead>
        <tbody className={cn(loading && "opacity-60 transition-opacity")}>
          {tickets.map((t) => (
            <tr
              key={t.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) return
                router.push(ticketHref(t.id))
              }}
              className={cn("cursor-pointer", TABLE.row)}
            >
              <td aria-hidden="true" />
              {TICKET_LIST_COLUMNS.map((c) => (
                <td key={c.key} className={cn(cell, "overflow-hidden", cellClass[c.key])}>
                  {cells[c.key](t)}
                </td>
              ))}
            </tr>
          ))}
          {tickets.length === 0 && (
            <tr>
              <td colSpan={TICKET_LIST_COLUMNS.length + 1} className="px-4 py-10 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
