"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TabsBar } from "@/components/ui/tabs-bar"
import { computeStatusLabel, currentUserLabel } from "@/lib/inventory/statusLabel"

interface AssetRow {
  id: string
  assetTag: string
  status: string
  ownerType: string
  ownerClientId: string | null
  ownerClient: { name: string } | null
  loanedToClientId: string | null
  deployedToContactId: string | null
  clientLocation: { name: string } | null
  containerPath: string | null
  catalogItem: { name: string; categoryRef: { name: string; parent: { name: string } | null } }
  deployedToContact: { firstName: string; lastName: string } | null
  loanedToContact: { firstName: string; lastName: string } | null
  assignedUser: { name: string } | null
}

interface StockRow {
  id: string
  quantity: number
  catalogItemId: string
  catalogItem: { name: string }
  locationId: string
  containerPath: string | null
}

type SubTab = "assets" | "stock"
type SortColumn = "assetTag" | "status" | "owner" | "location" | "currentUser"
type SortDirection = "asc" | "desc" | null
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  default: "py-3",
  comfortable: "py-5",
}

function ownerLabel(a: AssetRow): string {
  return a.ownerType === "COMPANY" ? "Us" : a.ownerClient?.name ?? "Unknown"
}

function categoryLabel(a: AssetRow): string {
  return a.catalogItem.categoryRef.parent
    ? `${a.catalogItem.categoryRef.parent.name} > ${a.catalogItem.categoryRef.name}`
    : a.catalogItem.categoryRef.name
}

function locationLabel(a: AssetRow): string {
  return a.containerPath ?? a.clientLocation?.name ?? "Unassigned"
}

function compareAssets(a: AssetRow, b: AssetRow, column: SortColumn): number {
  switch (column) {
    case "assetTag":
      return a.assetTag.localeCompare(b.assetTag)
    case "status":
      return computeStatusLabel(a).localeCompare(computeStatusLabel(b))
    case "owner":
      return ownerLabel(a).localeCompare(ownerLabel(b))
    case "location":
      return locationLabel(a).localeCompare(locationLabel(b))
    case "currentUser":
      return currentUserLabel(a).localeCompare(currentUserLabel(b))
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
      <button onClick={() => onSort(column)} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {active && sortDirection === "asc" && <ArrowUp size={12} />}
        {active && sortDirection === "desc" && <ArrowDown size={12} />}
        {!active && <ArrowUpDown size={12} className="opacity-30" />}
      </button>
    </th>
  )
}

const FILTER_SELECT_CLASS =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export default function InventoryListPage() {
  const router = useRouter()
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("assets")

  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<"active" | "all">("active")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [ownerFilter, setOwnerFilter] = useState("ALL")
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const [locationFilter, setLocationFilter] = useState("ALL")
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [density, setDensity] = useState<Density>("default")

  const [stock, setStock] = useState<StockRow[]>([])
  const [loadingStock, setLoadingStock] = useState(true)
  const [adjustingId, setAdjustingId] = useState<string | null>(null)
  const [adjustDelta, setAdjustDelta] = useState("")

  useEffect(() => {
    fetch("/api/inventory-assets")
      .then((res) => res.json())
      .then((json) => {
        setAssets(json)
        setLoadingAssets(false)
      })
  }, [])

  function loadStock() {
    fetch("/api/inventory-stock")
      .then((res) => res.json())
      .then((json) => {
        setStock(json)
        setLoadingStock(false)
      })
  }

  useEffect(() => {
    loadStock()
  }, [])

  // Decommissioned (Removed) assets are treated as inactive — hidden by
  // default, only surfaced when "Active & Inactive" is selected. Every
  // other filter's options are derived from whichever set is currently
  // in play, so a hidden Removed asset's status label doesn't linger in
  // the Status dropdown.
  const activeAssets = activeFilter === "all" ? assets : assets.filter((a) => a.status !== "REMOVED")

  const statusOptions = Array.from(new Set(activeAssets.map(computeStatusLabel))).sort()
  const ownerOptions = Array.from(new Set(activeAssets.map(ownerLabel))).sort()
  const categoryOptions = Array.from(new Set(activeAssets.map(categoryLabel))).sort()
  const locationOptions = Array.from(new Set(activeAssets.map(locationLabel))).sort()

  const filtered = activeAssets.filter((a) => {
    const matchesSearch = a.assetTag.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === "ALL" || computeStatusLabel(a) === statusFilter
    const matchesOwner = ownerFilter === "ALL" || ownerLabel(a) === ownerFilter
    const matchesCategory = categoryFilter === "ALL" || categoryLabel(a) === categoryFilter
    const matchesLocation = locationFilter === "ALL" || locationLabel(a) === locationFilter
    return matchesSearch && matchesStatus && matchesOwner && matchesCategory && matchesLocation
  })

  const sorted =
    sortColumn && sortDirection
      ? [...filtered].sort((a, b) => {
          const cmp = compareAssets(a, b, sortColumn)
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

  async function handleAdjust(stockId: string) {
    const delta = Number(adjustDelta)
    if (!Number.isInteger(delta) || delta === 0) return
    const res = await fetch(`/api/inventory-stock/${stockId}/adjust`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    })
    if (res.ok) {
      setAdjustingId(null)
      setAdjustDelta("")
      loadStock()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-display font-semibold tracking-tight text-foreground">Inventory</h1>
      </div>

      <TabsBar
        tabs={[
          { key: "assets", label: "Assets" },
          { key: "stock", label: "Stock" },
        ]}
        activeTab={activeSubTab}
        onChange={setActiveSubTab}
        ariaLabel="Inventory sections"
      />

      {activeSubTab === "assets" && (
        <div className="space-y-4">
          {loadingAssets ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    placeholder="Search by asset tag..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <select
                    value={activeFilter}
                    onChange={(e) => {
                      setActiveFilter(e.target.value as "active" | "all")
                      setStatusFilter("ALL")
                      e.target.blur()
                    }}
                    className={FILTER_SELECT_CLASS}
                  >
                    <option value="active">Active Only</option>
                    <option value="all">Active & Inactive</option>
                  </select>
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); e.target.blur() }} className={FILTER_SELECT_CLASS}>
                    <option value="ALL">All Statuses</option>
                    {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); e.target.blur() }} className={FILTER_SELECT_CLASS}>
                    <option value="ALL">All Owners</option>
                    {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); e.target.blur() }} className={FILTER_SELECT_CLASS}>
                    <option value="ALL">All Categories</option>
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); e.target.blur() }} className={FILTER_SELECT_CLASS}>
                    <option value="ALL">All Locations</option>
                    {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <select value={density} onChange={(e) => { setDensity(e.target.value as Density); e.target.blur() }} className={FILTER_SELECT_CLASS}>
                  <option value="compact">Compact rows</option>
                  <option value="default">Default rows</option>
                  <option value="comfortable">Comfortable rows</option>
                </select>
              </div>

              <div className="max-h-[70vh] overflow-y-auto overflow-x-auto rounded-lg border border-border bg-card shadow-card">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border text-left text-caption text-muted-foreground">
                      <SortableHeader label="Asset Tag" column="assetTag" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableHeader label="Owner" column="owner" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableHeader label="Location/Container" column="location" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <SortableHeader label="Current User" column="currentUser" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => router.push(`/dashboard/inventory/${a.id}`)}
                        className="border-b border-border cursor-pointer transition-colors hover:bg-surface-hover"
                      >
                        <td className={`${ROW_PADDING[density]} px-3`}>
                          <Link
                            href={`/dashboard/inventory/${a.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-foreground hover:underline hover:text-primary"
                          >
                            {a.assetTag}
                          </Link>
                        </td>
                        <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{computeStatusLabel(a)}</td>
                        <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{ownerLabel(a)}</td>
                        <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{locationLabel(a)}</td>
                        <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{currentUserLabel(a)}</td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          No assets found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {activeSubTab === "stock" && (
        <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
          {loadingStock ? (
            <p className="p-4 text-sm text-muted-foreground">Loading...</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-caption text-muted-foreground">
                  <th className="py-2 pl-4 pr-3">Catalog Item</th>
                  <th className="py-2 pr-3">Container</th>
                  <th className="py-2 pr-3 text-right">Quantity</th>
                  <th className="py-2 pr-4 text-right">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="py-2 pl-4 pr-3 text-foreground">{s.catalogItem.name}</td>
                    <td className="py-2 pr-3 text-foreground">{s.containerPath ?? "Unassigned"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium text-foreground">{s.quantity}</td>
                    <td className="py-2 pr-4 text-right">
                      {adjustingId === s.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            placeholder="+/-"
                            value={adjustDelta}
                            onChange={(e) => setAdjustDelta(e.target.value)}
                            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <Button size="sm" onClick={() => handleAdjust(s.id)}>Apply</Button>
                          <Button size="sm" variant="outline" onClick={() => { setAdjustingId(null); setAdjustDelta("") }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setAdjustingId(s.id); setAdjustDelta("") }}>Adjust</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {stock.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      No stock items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
