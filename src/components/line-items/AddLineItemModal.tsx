"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/Modal"

export interface CatalogOptionBase {
  id: string
  name: string
}

// Shared shell for "Add Line Item" modals across Sales Orders and
// Purchase Orders — both need the same Catalog-search / Ad-hoc tab
// pattern. What differs between them (which fields an ad-hoc item needs,
// what secondary info shows under a catalog result) is left as slots
// rather than baked in, since SO items need price/discount/vendor and PO
// items don't.
export function AddLineItemModal<T extends CatalogOptionBase>({
  catalog,
  catalogSubtitle,
  adhocForm,
  onClose,
  onAddCatalog,
  title = "Add Line Item",
}: {
  catalog: T[]
  catalogSubtitle: (item: T) => string
  adhocForm: ReactNode
  onClose: () => void
  onAddCatalog: (item: T, quantity: number) => void
  title?: string
}) {
  const [mode, setMode] = useState<"catalog" | "adhoc">("catalog")
  const [search, setSearch] = useState("")
  const [quantity, setQuantity] = useState(1)

  const filtered = catalog.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Modal maxWidth="lg">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setMode("catalog")}
            className={mode === "catalog" ? "font-semibold underline text-foreground" : "text-muted-foreground"}
          >
            From Catalog
          </button>
          <button
            onClick={() => setMode("adhoc")}
            className={mode === "adhoc" ? "font-semibold underline text-foreground" : "text-muted-foreground"}
          >
            Ad-Hoc Item
          </button>
        </div>
      </div>

      {mode === "catalog" && (
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or SKU..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filtered.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                <div>
                  <p className="font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{catalogSubtitle(item)}</p>
                </div>
                <Button size="sm" onClick={() => { onAddCatalog(item, quantity); onClose() }}>
                  Add
                </Button>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">No catalog items match.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Qty</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {mode === "adhoc" && adhocForm}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}