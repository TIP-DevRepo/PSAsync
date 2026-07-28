"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"

interface Client {
  id: string
  name: string
  email: string | null
  phone: string | null
  status: string
  industry: string | null
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-success-bg text-success",
  PROSPECT: "bg-info-bg text-info",
  INACTIVE: "bg-muted text-muted-foreground",
  LOST: "bg-danger-bg text-danger",
}

type SortColumn = "name" | "industry" | "email" | "phone" | "status"
type SortDirection = "asc" | "desc" | null
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  default: "py-3",
  comfortable: "py-5",
}

function compareClients(a: Client, b: Client, column: SortColumn): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name)
    case "industry":
      return (a.industry ?? "").localeCompare(b.industry ?? "")
    case "email":
      return (a.email ?? "").localeCompare(b.email ?? "")
    case "phone":
      return (a.phone ?? "").localeCompare(b.phone ?? "")
    case "status":
      return a.status.localeCompare(b.status)
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
}: {
  label: string
  column: SortColumn
  sortColumn: SortColumn | null
  sortDirection: SortDirection
  onSort: (column: SortColumn) => void
}) {
  const active = sortColumn === column
  return (
    <th className="py-2 px-3 select-none uppercase tracking-wide">
      <button
        onClick={() => onSort(column)}
        className="flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {active && sortDirection === "asc" && <ArrowUp size={12} />}
        {active && sortDirection === "desc" && <ArrowDown size={12} />}
        {!active && <ArrowUpDown size={12} className="opacity-30" />}
      </button>
    </th>
  )
}

export default function ClientsListPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [density, setDensity] = useState<Density>("default")

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((json) => {
        setClients(json)
        setLoading(false)
      })
  }, [])

  const filtered = clients.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === "ALL" || c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const sorted =
    sortColumn && sortDirection
      ? [...filtered].sort((a, b) => {
          const cmp = compareClients(a, b, sortColumn)
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

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-display font-semibold tracking-tight text-foreground">Clients</h1>
        <Link href="/dashboard/clients/new">
          <Button>Add Client</Button>
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by name..."
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
            <option value="ACTIVE">Active</option>
            <option value="PROSPECT">Prospect</option>
            <option value="INACTIVE">Inactive</option>
            <option value="LOST">Lost</option>
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
              <SortableHeader label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Industry" column="industry" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Email" column="email" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Phone" column="phone" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((client) => (
              <tr
                key={client.id}
                onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                className="border-b border-border cursor-pointer transition-colors hover:bg-surface-hover"
              >
                <td className={`${ROW_PADDING[density]} px-3`}>
                  <Link
                    href={`/dashboard/clients/${client.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-foreground hover:underline hover:text-primary"
                  >
                    {client.name}
                  </Link>
                </td>
                <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{client.industry ?? "—"}</td>
                <td className={`${ROW_PADDING[density]} px-3 text-muted-foreground`}>{client.email ?? "—"}</td>
                <td className={`${ROW_PADDING[density]} px-3 text-muted-foreground`}>{client.phone ?? "—"}</td>
                <td className={`${ROW_PADDING[density]} px-3`}>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[client.status]}`}>
                    {client.status}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  No clients found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}