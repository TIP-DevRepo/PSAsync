"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
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

// Fixed widths: below their total the table scrolls sideways, and long
// text truncates with the full value in a tooltip. Never squeezed.
const COLUMNS: { key: SortColumn; label: string; width: number; align?: "right" }[] = [
  { key: "number", label: "Number", width: 150 },
  { key: "title", label: "Title", width: 260 },
  { key: "client", label: "Client", width: 190 },
  { key: "contact", label: "Contact", width: 170 },
  { key: "owner", label: "Owner", width: 150 },
  { key: "stage", label: "Stage", width: 160 },
  { key: "type", label: "Type", width: 150 },
  { key: "value", label: "Value", width: 140, align: "right" },
  { key: "expectedClose", label: "Expected close", width: 140 },
  { key: "updated", label: "Updated", width: 120 },
]
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0)

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
      className={`select-none py-2 pr-3 first:pl-4 ${align === "right" ? "text-right" : ""}`}
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

  const stageOrder = new Map(stages.map((s, i) => [s.id, i]))
  const sorted =
    sortColumn && sortDirection
      ? [...opportunities].sort((a, b) => {
          const cmp = compare(a, b, sortColumn, stageOrder)
          return sortDirection === "asc" ? cmp : -cmp
        })
      : opportunities

  const cell = "py-3 pr-3 first:pl-4 truncate"

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card shadow-card">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: TABLE_MIN_WIDTH }}>
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border text-left text-caption text-muted-foreground">
            {COLUMNS.map((c) => (
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
        </thead>
        <tbody>
          {sorted.map((o) => {
            const href = `/dashboard/opportunities/${o.id}`
            const contact = contactName(o.contact)
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
                <td className={`${cell} font-medium tabular-nums`}>
                  <Link href={href} className="text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {o.number}
                  </Link>
                </td>
                <td className={`${cell} text-foreground`} title={o.title}>
                  {o.title}
                </td>
                <td className={`${cell} text-foreground`} title={o.client.name}>
                  {o.client.name}
                </td>
                <td className={`${cell} text-muted-foreground`} title={contact}>
                  {contact}
                </td>
                <td className={`${cell} text-muted-foreground`} title={o.owner?.name ?? "Unassigned"}>
                  {o.owner?.name ?? "Unassigned"}
                </td>
                <td className={cell}>
                  <StagePill name={o.stage.name} category={o.stage.category} />
                </td>
                <td className={`${cell} text-muted-foreground`} title={o.type?.name}>
                  {o.type?.name ?? "-"}
                </td>
                <td className={`${cell} text-right font-medium tabular-nums text-foreground`}>
                  {o.expectedValue === null ? "-" : formatCents(valueCents(o.expectedValue))}
                </td>
                <td className={`${cell} text-muted-foreground`}>{formatDateOnly(o.expectedCloseDate)}</td>
                <td className={`${cell} text-muted-foreground`}>{formatDate(o.updatedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
