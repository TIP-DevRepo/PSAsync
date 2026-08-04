"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import Link from "next/link"

interface SalesOrder {
  id: string
  soNumber: string
  status: string
  clientPoNumber: string | null
  clientName: string
  owner: { id: string; name: string } | null
  total: number
  poCount: number
  createdAt: string
}

// Reusing the same 5-token semantic scale as the Quotes stage colors —
// DRAFT/CLOSED map cleanly, the middle pipeline states reuse warning
// (pending action) and primary (actively in progress) rather than
// inventing new one-off colors for a 7-status pipeline.
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  READY_TO_INVOICE: "bg-warning-bg text-warning",
  INVOICED: "bg-info-bg text-info",
  READY_TO_ORDER: "bg-primary/10 text-primary",
  PARTS_ORDERED: "bg-warning-bg text-warning",
  READY_TO_CLOSEOUT: "bg-primary/10 text-primary",
  CLOSED: "bg-success-bg text-success",
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

type SortColumn = "soNumber" | "clientName" | "owner" | "status" | "total" | "poCount" | "createdAt"
type SortDirection = "asc" | "desc" | null
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  default: "py-3",
  comfortable: "py-5",
}

function compareOrders(a: SalesOrder, b: SalesOrder, column: SortColumn): number {
  switch (column) {
    case "soNumber":
      return a.soNumber.localeCompare(b.soNumber)
    case "clientName":
      return a.clientName.localeCompare(b.clientName)
    case "owner":
      return (a.owner?.name ?? "").localeCompare(b.owner?.name ?? "")
    case "status":
      return a.status.localeCompare(b.status)
    case "total":
      return a.total - b.total
    case "poCount":
      return a.poCount - b.poCount
    case "createdAt":
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    default:
      return 0
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
    <th className={`py-2 pr-3 select-none uppercase tracking-wide ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(column)}
        className={`flex items-center gap-1 hover:text-foreground ${align === "right" ? "ml-auto" : ""}`}
      >
        {label}
        {active && sortDirection === "asc" && <ArrowUp size={12} />}
        {active && sortDirection === "desc" && <ArrowDown size={12} />}
        {!active && <ArrowUpDown size={12} className="opacity-30" />}
      </button>
    </th>
  )
}

export default function SalesOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [density, setDensity] = useState<Density>("default")

  useEffect(() => {
    fetch("/api/sales-orders")
      .then((res) => res.json())
      .then((json) => {
        setOrders(json)
        setLoading(false)
      })
  }, [])

  const filtered = orders.filter((o) => {
    const matchesSearch =
      o.soNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.clientName.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === "ALL" || o.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const sorted =
    sortColumn && sortDirection
      ? [...filtered].sort((a, b) => {
          const cmp = compareOrders(a, b, sortColumn)
          return sortDirection === "asc" ? cmp : -cmp
        })
      : filtered

  function handleSort(column: SortColumn) {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDirection("asc")
    } else if (sortDirection === "asc") {
      setSortDirection("desc")
    } else if (sortDirection === "desc") {
      setSortColumn(null)
      setSortDirection(null)
    } else {
      setSortDirection("asc")
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-display font-semibold tracking-tight text-foreground">Sales Orders</h1>
        <Link href="/dashboard/sales-orders/new">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            + New Sales Order
          </button>
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by SO #, or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              e.target.blur()
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="READY_TO_INVOICE">Ready to Invoice</option>
            <option value="INVOICED">Invoiced</option>
            <option value="READY_TO_ORDER">Ready to Order</option>
            <option value="PARTS_ORDERED">Parts Ordered</option>
            <option value="READY_TO_CLOSEOUT">Ready to Closeout</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <select
          value={density}
          onChange={(e) => {
            setDensity(e.target.value as Density)
            e.target.blur()
          }}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="compact">Compact rows</option>
          <option value="default">Default rows</option>
          <option value="comfortable">Comfortable rows</option>
        </select>
      </div>

      <div className="max-h-[70vh] overflow-y-auto overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <SortableHeader label="SO Number" column="soNumber" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Customer" column="clientName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Owner" column="owner" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <SortableHeader label="POs" column="poCount" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <SortableHeader label="Created" column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((so) => (
              <tr
                key={so.id}
                onClick={() => router.push(`/dashboard/sales-orders/${so.id}`)}
                className="border-b border-border cursor-pointer transition-colors hover:bg-surface-hover"
              >
                <td className={`${ROW_PADDING[density]} pr-3 font-medium text-foreground`}>{so.soNumber}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-foreground`}>{so.clientName}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{so.owner?.name ?? "—"}</td>
                <td className={`${ROW_PADDING[density]} pr-3`}>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[so.status]}`}>
                    {statusLabel(so.status)}
                  </span>
                </td>
                <td className={`${ROW_PADDING[density]} pr-3 text-right tabular-nums font-medium text-foreground`}>${so.total.toFixed(2)}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-right tabular-nums text-muted-foreground`}>{so.poCount}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{new Date(so.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  No Sales Orders found. Create one manually or accept a Quote to generate one automatically.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}