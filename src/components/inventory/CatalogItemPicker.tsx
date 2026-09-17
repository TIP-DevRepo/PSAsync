"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { CategoryPicker } from "@/components/categories/CategoryPicker"

export interface CatalogItemOption {
  id: string
  name: string
  description: string | null
  categoryId: string
  categoryRef: { name: string; parent: { name: string } | null }
  isSerialized: boolean
  cost: number
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function categoryPath(item: CatalogItemOption): string {
  if (!item.categoryRef) return ""
  return item.categoryRef.parent ? `${item.categoryRef.parent.name} > ${item.categoryRef.name}` : item.categoryRef.name
}

// Search-and-select an existing Catalog Item, or create one inline without
// leaving the parent form. isSerialized filters the list to match whichever
// Serialized Asset / Pooled Stock toggle the parent has active, and fixes
// the value used when creating a new item here too.
export function CatalogItemPicker({
  isSerialized,
  value,
  onChange,
}: {
  isSerialized: boolean
  value: CatalogItemOption | null
  onChange: (item: CatalogItemOption) => void
}) {
  const [items, setItems] = useState<CatalogItemOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState(false)

  const [newForm, setNewForm] = useState({
    name: "",
    categoryId: "",
    cost: "",
    msrp: "",
    description: "",
    unit: "each",
  })
  const [creatingSaving, setCreatingSaving] = useState(false)
  const [createError, setCreateError] = useState("")

  function loadItems() {
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((data: CatalogItemOption[]) => {
        if (Array.isArray(data)) setItems(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadItems()
  }, [])

  const filtered = useMemo(
    () =>
      items
        .filter((i) => i.isSerialized === isSerialized)
        .filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [items, isSerialized, search]
  )

  function update(field: keyof typeof newForm, val: string) {
    setNewForm((prev) => ({ ...prev, [field]: val }))
  }

  async function handleCreate() {
    if (!newForm.name.trim()) {
      setCreateError("Item name is required.")
      return
    }
    if (!newForm.categoryId) {
      setCreateError("Category is required.")
      return
    }

    setCreatingSaving(true)
    setCreateError("")

    const res = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newForm.name,
        categoryId: newForm.categoryId,
        isSerialized,
        cost: newForm.cost,
        msrp: newForm.msrp,
        description: newForm.description,
        unit: newForm.unit,
      }),
    })

    setCreatingSaving(false)

    if (!res.ok) {
      setCreateError("Something went wrong creating this Catalog Item.")
      return
    }

    const item = await res.json()
    loadItems()
    onChange(item)
    setCreating(false)
    setPicking(false)
    setNewForm({ name: "", categoryId: "", cost: "", msrp: "", description: "", unit: "each" })
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground mb-1">Catalog Item *</label>

      {value && !creating && !picking ? (
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-foreground">{value.name}</p>
              <p className="text-xs text-muted-foreground">{categoryPath(value)}</p>
              {value.description && <p className="mt-1 text-xs text-muted-foreground">{value.description}</p>}
              <p className="mt-1 text-xs text-muted-foreground">Cost: ${value.cost.toFixed(2)}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
              Change
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {!creating && (
            <>
              <input
                type="text"
                placeholder="Search Catalog Items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={SELECT_CLASS}
              />
              <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {loading && <p className="p-3 text-sm text-muted-foreground">Loading...</p>}
                {!loading && filtered.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">No matching Catalog Items.</p>
                )}
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { onChange(item); setPicking(false) }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors"
                  >
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{categoryPath(item)}</p>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                + Create new Catalog Item
              </Button>
            </>
          )}

          {creating && (
            <div className="rounded-md border border-border bg-card p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">New Catalog Item ({isSerialized ? "Serialized" : "Pooled Stock"})</p>
                <Button size="sm" variant="outline" onClick={() => { setCreating(false); setCreateError("") }}>
                  Cancel
                </Button>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Item Name *</label>
                <input
                  type="text"
                  value={newForm.name}
                  onChange={(e) => update("name", e.target.value)}
                  className={SELECT_CLASS}
                />
              </div>

              <CategoryPicker value={newForm.categoryId} onChange={(categoryId) => update("categoryId", categoryId)} />

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Description</label>
                <textarea
                  value={newForm.description}
                  onChange={(e) => update("description", e.target.value)}
                  rows={2}
                  className={SELECT_CLASS}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Cost Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newForm.cost}
                    onChange={(e) => update("cost", e.target.value)}
                    className={SELECT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">MSRP ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newForm.msrp}
                    onChange={(e) => update("msrp", e.target.value)}
                    className={SELECT_CLASS}
                  />
                </div>
              </div>

              {createError && <p className="text-sm text-danger">{createError}</p>}

              <Button size="sm" onClick={handleCreate} disabled={creatingSaving}>
                {creatingSaving ? "Creating..." : "Create & Use"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
