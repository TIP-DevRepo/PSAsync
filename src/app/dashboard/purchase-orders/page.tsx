"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import Link from "next/link"

interface PurchaseOrder {
  id: string
  poNumber: string
  status: string
  vendorName: string
  ownerName: string
  soNumber: string | null
  total: number
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PARTS_ORDERED: "bg-info-bg text-info",
  RECEIVED: "bg-success-bg text-success",
  ON_HOLD: "bg-warning-bg text-warning",
  BACKORDERED: "bg-warning-bg text-warning",
  CANCELLED: "bg-danger-bg text-danger",
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

type SortColumn = "poNumber" | "vendorName" | "ownerName" | "soNumber" | "status" | "total" | "createdAt"
type SortDirection = "asc" | "desc" | null
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  default: "py-3",
  comfortable: "py-5",
}

function compareOrders(a: PurchaseOrder, b: PurchaseOrder, column: SortColumn): number {
  switch (column) {
    case "poNumber":
      return a.poNumber.localeCompare(b.poNumber)
    case "vendorName":
      return a.vendorName.localeCompare(b.vendorName)
    case "ownerName":
      return a.ownerName.localeCompare(b.ownerName)
    case "soNumber":
      return (a.soNumber ?? "").localeCompare(b.soNumber ?? "")
    case "status":
      return a.status.localeCompare(b.status)
    case "total":
      return a.total - b.total
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

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [density, setDensity] = useState<Density>("default")

  useEffect(() => {
    fetch("/api/purchase-orders")
      .then((res) => res.json())
      .then((json) => {
        setOrders(json)
        setLoading(false)
      })
  }, [])

  const filtered = orders.filter((o) => {
    const matchesSearch =
      o.poNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.vendorName.toLowerCase().includes(search.toLowerCase())
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
        <h1 className="text-display font-semibold tracking-tight text-foreground">Purchase Orders</h1>
        <Link href="/dashboard/purchase-orders/new">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            + New Purchase Order
          </button>
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by PO #, or vendor..."
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
            <option value="PARTS_ORDERED">Parts Ordered</option>
            <option value="RECEIVED">Received</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="BACKORDERED">Backordered</option>
            <option value="CANCELLED">Cancelled</option>
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
              <SortableHeader label="PO Number" column="poNumber" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Vendor" column="vendorName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Owner" column="ownerName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="From SO" column="soNumber" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <SortableHeader label="Created" column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((po) => (
              <tr
                key={po.id}
                onClick={() => router.push(`/dashboard/purchase-orders/${po.id}`)}
                className="border-b border-border cursor-pointer transition-colors hover:bg-surface-hover"
              >
                <td className={`${ROW_PADDING[density]} pr-3 font-medium text-foreground`}>{po.poNumber}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-foreground`}>{po.vendorName}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{po.ownerName}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{po.soNumber ?? "—"}</td>
                <td className={`${ROW_PADDING[density]} pr-3`}>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[po.status]}`}>
                    {statusLabel(po.status)}
                  </span>
                </td>
                <td className={`${ROW_PADDING[density]} pr-3 text-right tabular-nums font-medium text-foreground`}>${po.total.toFixed(2)}</td>
                <td className={`${ROW_PADDING[density]} pr-3 text-muted-foreground`}>{new Date(po.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  No Purchase Orders found. Create one manually or generate one from a Sales Order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}