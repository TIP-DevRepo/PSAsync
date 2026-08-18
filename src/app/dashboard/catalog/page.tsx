"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"

interface CatalogItem {
  id: string
  name: string
  categoryId: string
  categoryRef: { name: string; parent: { name: string } | null }
  type: string
  msrp: number
  cost: number
  taxable: boolean
  active: boolean
  vendor: { name: string } | null
  vendorSku: string | null
  manufacturer: { name: string } | null
  manufacturerSku: string | null
}

type SortColumn = "name" | "category" | "type" | "cost" | "msrp" | "status"
type SortDirection = "asc" | "desc" | null
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1.5",
  default: "py-3",
  comfortable: "py-5",
}

function categoryLabel(item: CatalogItem): string {
  return item.categoryRef.parent
    ? `${item.categoryRef.parent.name} > ${item.categoryRef.name}`
    : item.categoryRef.name
}

function compareItems(a: CatalogItem, b: CatalogItem, column: SortColumn): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name)
    case "category":
      return categoryLabel(a).localeCompare(categoryLabel(b))
    case "cost":
      return a.cost - b.cost
    case "msrp":
      return a.msrp - b.msrp
    case "status":
      return Number(a.active) - Number(b.active)
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
    <th className={`py-2 px-3 select-none uppercase tracking-wide ${align === "right" ? "text-right" : ""}`}>
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

export default function CatalogListPage() {
  const router = useRouter()
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [density, setDensity] = useState<Density>("default")

  useEffect(() => {
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((json) => {
        setItems(json)
        setLoading(false)
      })
  }, [])

  const categories = Array.from(new Set(items.map((i) => categoryLabel(i))))

  const filtered = items.filter((i) => {
    const matchesSearch =
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.vendorSku ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (i.manufacturerSku ?? "").toLowerCase().includes(search.toLowerCase())
    const matchesCategory = categoryFilter === "ALL" || categoryLabel(i) === categoryFilter
    return matchesSearch && matchesCategory
  })

  const sorted =
    sortColumn && sortDirection
      ? [...filtered].sort((a, b) => {
          const cmp = compareItems(a, b, sortColumn)
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
        <h1 className="text-display font-semibold tracking-tight text-foreground">Product Catalog</h1>
        <Link href="/dashboard/catalog/new">
          <Button>Add Item</Button>
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by name, vendor SKU, or manufacturer SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              e.target.blur()
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ALL">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
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
              <SortableHeader label="Category" column="category" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Type" column="type" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
              <SortableHeader label="Cost" column="cost" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <SortableHeader label="MSRP" column="msrp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
              <th className="py-2 px-3 uppercase tracking-wide text-center">Taxable</th>
              <SortableHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr
                key={item.id}
                onClick={() => router.push(`/dashboard/catalog/${item.id}`)}
                className="border-b border-border cursor-pointer transition-colors hover:bg-surface-hover"
              >
                <td className={`${ROW_PADDING[density]} px-3`}>
                  <Link
                    href={`/dashboard/catalog/${item.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-foreground hover:underline hover:text-primary"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{categoryLabel(item)}</td>
                <td className={`${ROW_PADDING[density]} px-3 text-foreground`}>{item.type}</td>
                <td className={`${ROW_PADDING[density]} px-3 text-right tabular-nums text-foreground`}>${item.cost.toFixed(2)}</td>
                <td className={`${ROW_PADDING[density]} px-3 text-right tabular-nums font-medium text-foreground`}>${item.msrp.toFixed(2)}</td>
                <td className={`${ROW_PADDING[density]} px-3 text-center text-muted-foreground`}>{item.taxable ? "Yes" : "No"}</td>
                <td className={`${ROW_PADDING[density]} px-3`}>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                    item.active ? "bg-success-bg text-success" : "bg-muted text-muted-foreground"
                  }`}>
                    {item.active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground">
                  No catalog items found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}