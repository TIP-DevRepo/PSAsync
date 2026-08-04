"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/Modal"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { Pencil, Check, Copy } from "lucide-react"
import { toast } from "@/lib/toast"

// ─── Types ────────────────────────────────────────────────────────────────
export type RecurringInterval = "MONTHLY" | "QUARTERLY" | "ANNUALLY"

export interface SOLineItemBuilderItem {
  id: string
  catalogItemId: string | null
  vendorId: string | null
  vendor: { id: string; name: string } | null
  partNumber: string | null
  sku: string | null
  vendorSku: string | null
  name: string
  description: string | null
  quantity: number
  unitPrice: number
  cost: number
  discount: number
  taxable: boolean
  isRecurring: boolean
  recurringInterval: RecurringInterval | null
  bundleName: string | null
  bundleDisplayMode: string | null
  isBundleHeader: boolean
  sortOrder: number
}

export interface SOCatalogOption {
  id: string
  name: string
  sku: string | null
  msrp: number
  cost: number
  taxable: boolean
  vendorId: string | null
  vendor: { id: string; name: string } | null
}

export interface SOVendorOption {
  id: string
  name: string
}

// Combines isRecurring + recurringInterval into one selectable value so
// "Type" can be a single dropdown instead of a checkbox plus a
// conditionally-rendered second control.
type TypeValue = "ONE_TIME" | RecurringInterval

function typeValueOf(li: SOLineItemBuilderItem): TypeValue {
  if (!li.isRecurring) return "ONE_TIME"
  return li.recurringInterval ?? "MONTHLY"
}

function typePatchFor(value: TypeValue): Partial<SOLineItemBuilderItem> {
  if (value === "ONE_TIME") return { isRecurring: false, recurringInterval: null }
  return { isRecurring: true, recurringInterval: value }
}

function lineTotal(li: SOLineItemBuilderItem) {
  return li.unitPrice * li.quantity * (1 - li.discount / 100)
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

function typeLabel(li: SOLineItemBuilderItem) {
  if (!li.isRecurring) return "One-time"
  if (!li.recurringInterval) return "Recurring"
  return `Recurring (${li.recurringInterval.charAt(0) + li.recurringInterval.slice(1).toLowerCase()})`
}

// Small inline "value + copy button" pairing used for Part # and Vendor
// SKU in read-only mode — copies straight to the clipboard so you don't
// have to click into edit mode just to grab a value.
function CopyableCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-1 min-w-0">
      <span className="truncate">{value}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value)
          toast.success("Copied")
        }}
        title="Copy"
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <Copy size={11} />
      </button>
    </span>
  )
}

// Locked, percentage-based column widths — shared by every row regardless
// of read or edit mode. Without this, the browser recalculates column
// widths for the whole table any time one row's content changes (e.g.
// switching to wider edit-mode inputs), which visually squeezes/merges
// adjacent cells. Percentages (rather than fixed px) also mean the table
// always fills 100% of its container instead of leaving dead space on
// wide screens — Description gets the largest share since it's the one
// column that benefits most from extra room.
const COLUMN_WIDTHS = [3, 8, 22, 11, 9, 5, 7, 7, 6, 7, 8, 7]

function ColGroup() {
  return (
    <colgroup>
      {COLUMN_WIDTHS.map((w, i) => (
        <col key={i} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  )
}

interface SOLineItemBuilderProps {
  items: SOLineItemBuilderItem[]
  catalog: SOCatalogOption[]
  vendors: SOVendorOption[]
  locked?: boolean
  onCreate: (payload: Partial<SOLineItemBuilderItem>) => void | Promise<void>
  onUpdate: (id: string, patch: Partial<SOLineItemBuilderItem>) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onDuplicate: (li: SOLineItemBuilderItem) => void | Promise<void>
}

export function SOLineItemBuilder({
  items,
  catalog,
  vendors,
  locked = false,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
}: SOLineItemBuilderProps) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [addToBundleName, setAddToBundleName] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder)
  const topLevel = sorted.filter((li) => !li.bundleName || li.isBundleHeader)

  function childrenOf(bundleName: string) {
    return sorted.filter((li) => li.bundleName === bundleName && !li.isBundleHeader)
  }

  async function moveTopLevel(id: string, direction: "up" | "down") {
    const idx = topLevel.findIndex((li) => li.id === id)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= topLevel.length) return
    const a = topLevel[idx]
    const b = topLevel[swapIdx]
    await Promise.all([
      onUpdate(a.id, { sortOrder: b.sortOrder }),
      onUpdate(b.id, { sortOrder: a.sortOrder }),
    ])
  }

  async function moveBundleChild(bundleName: string, id: string, direction: "up" | "down") {
    const children = childrenOf(bundleName)
    const idx = children.findIndex((li) => li.id === id)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= children.length) return
    const a = children[idx]
    const b = children[swapIdx]
    await Promise.all([
      onUpdate(a.id, { sortOrder: b.sortOrder }),
      onUpdate(b.id, { sortOrder: a.sortOrder }),
    ])
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmDialog({
      title: "Remove this line item?",
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!confirmed) return
    await onDelete(id)
  }

  async function handleAddBundle() {
    const bundleName = await promptDialog({
      title: "Name this bundle",
      placeholder: 'e.g. "Starter Kit"',
    })
    if (!bundleName) return
    await onCreate({ name: bundleName.trim(), bundleName: bundleName.trim(), isBundleHeader: true })
  }

  function openAdd(bundleName: string | null) {
    setAddToBundleName(bundleName)
    setShowAddModal(true)
  }

  function renderRow(li: SOLineItemBuilderItem, isChild: boolean) {
    const total = lineTotal(li)
    const isEditing = editingId === li.id
    // Existing rows created before partNumber existed only have data in
    // sku — fall back to it so the field never appears to "lose" data
    // just because you opened the row for editing.
    const partNumberValue = li.partNumber ?? li.sku ?? ""

    return (
      <tr key={li.id} className={`border-b border-border last:border-0 ${isChild ? "bg-muted/40" : ""}`}>
        <td className={`py-2 pr-1 align-top ${isChild ? "pl-8" : "pl-4"}`}>
          {!locked && (
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => (isChild ? moveBundleChild(li.bundleName!, li.id, "up") : moveTopLevel(li.id, "up"))}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ▲
              </button>
              <button
                onClick={() => (isChild ? moveBundleChild(li.bundleName!, li.id, "down") : moveTopLevel(li.id, "down"))}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ▼
              </button>
            </div>
          )}
        </td>

        {isEditing ? (
          <>
            <td className="py-2 pr-2 align-top">
              <input
                type="text"
                defaultValue={partNumberValue}
                onBlur={(e) => onUpdate(li.id, { partNumber: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              />
            </td>
            <td className="py-2 pr-2 align-top">
              <input
                type="text"
                defaultValue={li.name}
                onBlur={(e) => onUpdate(li.id, { name: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground"
              />
              <input
                type="text"
                defaultValue={li.description ?? ""}
                placeholder="Description"
                onBlur={(e) => onUpdate(li.id, { description: e.target.value })}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
              />
            </td>
            <td className="py-2 pr-2 align-top">
              <select
                value={li.vendorId ?? ""}
                onChange={(e) => onUpdate(li.id, { vendorId: e.target.value || null })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="">—</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </td>
            <td className="py-2 pr-2 align-top">
              <input
                type="text"
                defaultValue={li.vendorSku ?? ""}
                onBlur={(e) => onUpdate(li.id, { vendorSku: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input
                type="number"
                defaultValue={li.quantity}
                onBlur={(e) => onUpdate(li.id, { quantity: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-right text-foreground tabular-nums"
              />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input
                type="number"
                step="0.01"
                defaultValue={li.cost}
                onBlur={(e) => onUpdate(li.id, { cost: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-right text-foreground tabular-nums"
              />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input
                type="number"
                step="0.01"
                defaultValue={li.unitPrice}
                onBlur={(e) => onUpdate(li.id, { unitPrice: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-right text-foreground tabular-nums"
              />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input
                type="number"
                step="1"
                defaultValue={li.discount}
                onBlur={(e) => onUpdate(li.id, { discount: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-right text-foreground tabular-nums"
              />
            </td>
            <td className="py-2 pr-2 align-top text-right font-medium text-foreground tabular-nums">{money(total)}</td>
            <td className="py-2 pr-2 align-top">
              <select
                value={typeValueOf(li)}
                onChange={(e) => onUpdate(li.id, typePatchFor(e.target.value as TypeValue))}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="ONE_TIME">One-time</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUALLY">Annually</option>
              </select>
            </td>
            <td className="py-2 pr-4 align-top">
              <div className="flex items-center gap-2">
                <button onClick={() => setEditingId(null)} title="Done" className="text-success hover:opacity-80">
                  <Check size={15} />
                </button>
                <button onClick={() => onDuplicate(li)} title="Duplicate" className="text-xs text-muted-foreground hover:text-foreground">⧉</button>
                <button onClick={() => handleDelete(li.id)} title="Delete" className="text-xs text-danger hover:underline">✕</button>
              </div>
            </td>
          </>
        ) : (
          <>
            <td className="py-2 pr-2 align-top text-muted-foreground">
              <CopyableCell value={partNumberValue || null} />
            </td>
            <td className="py-2 pr-2 align-top">
              {li.bundleName && (
                <p className="text-xs text-primary">📦 in {li.bundleName}</p>
              )}
              <span className="text-foreground">{li.name}</span>
              {li.description && <p className="text-xs text-muted-foreground truncate">{li.description}</p>}
            </td>
            <td className="py-2 pr-2 align-top text-muted-foreground truncate">{li.vendor?.name ?? "—"}</td>
            <td className="py-2 pr-2 align-top text-muted-foreground">
              <CopyableCell value={li.vendorSku} />
            </td>
            <td className="py-2 pr-2 align-top text-right text-foreground tabular-nums">{li.quantity}</td>
            <td className="py-2 pr-2 align-top text-right text-muted-foreground tabular-nums">{money(li.cost)}</td>
            <td className="py-2 pr-2 align-top text-right text-foreground tabular-nums">{money(li.unitPrice)}</td>
            <td className="py-2 pr-2 align-top text-right text-muted-foreground tabular-nums">{li.discount ? `${li.discount}%` : "—"}</td>
            <td className="py-2 pr-2 align-top text-right font-medium text-foreground tabular-nums">{money(total)}</td>
            <td className="py-2 pr-2 align-top text-muted-foreground truncate">{typeLabel(li)}</td>
            <td className="py-2 pr-4 align-top">
              {!locked && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingId(li.id)} title="Edit" className="text-muted-foreground hover:text-foreground">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => onDuplicate(li)} title="Duplicate" className="text-xs text-muted-foreground hover:text-foreground">⧉</button>
                  <button onClick={() => handleDelete(li.id)} title="Delete" className="text-xs text-danger hover:underline">✕</button>
                </div>
              )}
            </td>
          </>
        )}
      </tr>
    )
  }

  return (
    <div className="space-y-3">
      {!locked && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => openAdd(null)}>+ Add Line Item</Button>
          <Button size="sm" variant="outline" onClick={handleAddBundle}>+ Bundle</Button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
        <table className="w-full text-sm border-collapse table-fixed">
          <ColGroup />
          <thead>
            <tr className="border-b border-border text-left text-caption text-muted-foreground">
              <th className="py-2 pl-4 pr-1"></th>
              <th className="py-2 pr-2">Part #</th>
              <th className="py-2 pr-2">Description</th>
              <th className="py-2 pr-2">Vendor</th>
              <th className="py-2 pr-2">Vendor SKU</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Cost</th>
              <th className="py-2 pr-2 text-right">Price</th>
              <th className="py-2 pr-2 text-right">Discount</th>
              <th className="py-2 pr-2 text-right">Total</th>
              <th className="py-2 pr-2">Type</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {topLevel.map((li) => {
              if (li.isBundleHeader) {
                const children = childrenOf(li.bundleName!)
                return (
                  <>
                    <tr key={li.id} className="border-b border-border bg-primary/5">
                      <td className="py-2 pl-4" colSpan={12}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-primary">📦</span>
                          <input
                            type="text"
                            defaultValue={li.name}
                            disabled={locked}
                            onBlur={(e) => onUpdate(li.id, { name: e.target.value })}
                            className="rounded border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground"
                          />
                          <select
                            value={li.bundleDisplayMode ?? "COLLAPSED"}
                            disabled={locked}
                            onChange={(e) => onUpdate(li.id, { bundleDisplayMode: e.target.value })}
                            className="rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground"
                          >
                            <option value="COLLAPSED">Combined price</option>
                            <option value="ITEMIZED">Itemized</option>
                          </select>
                          {!locked && (
                            <>
                              <button onClick={() => openAdd(li.bundleName)} className="text-xs text-primary hover:underline">
                                + Add Item to Bundle
                              </button>
                              <button onClick={() => handleDelete(li.id)} title="Delete bundle (items inside stay)" className="text-xs text-danger hover:underline ml-auto">
                                ✕
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {children.map((c) => renderRow(c, true))}
                  </>
                )
              }
              return renderRow(li, false)
            })}
            {topLevel.length === 0 && (
              <tr>
                <td colSpan={12} className="py-6 text-center text-muted-foreground">
                  No line items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <AddSOLineItemModal
          catalog={catalog}
          vendors={vendors}
          onClose={() => {
            setShowAddModal(false)
            setAddToBundleName(null)
          }}
          onAddCatalog={(item, quantity) =>
            onCreate({
              catalogItemId: item.id,
              name: item.name,
              partNumber: item.sku ?? undefined,
              vendorId: item.vendorId ?? undefined,
              unitPrice: item.msrp,
              cost: item.cost,
              taxable: item.taxable,
              quantity,
              bundleName: addToBundleName ?? undefined,
            })
          }
          onAddAdhoc={(payload) =>
            onCreate({ ...payload, bundleName: addToBundleName ?? undefined })
          }
        />
      )}
    </div>
  )
}

// ─── Add Line Item Modal ────────────────────────────────────────────────
function AddSOLineItemModal({
  catalog,
  vendors,
  onClose,
  onAddCatalog,
  onAddAdhoc,
}: {
  catalog: SOCatalogOption[]
  vendors: SOVendorOption[]
  onClose: () => void
  onAddCatalog: (item: SOCatalogOption, quantity: number) => void
  onAddAdhoc: (payload: Partial<SOLineItemBuilderItem>) => void
}) {
  const [mode, setMode] = useState<"catalog" | "adhoc">("catalog")
  const [search, setSearch] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [adhoc, setAdhoc] = useState({
    name: "",
    partNumber: "",
    vendorId: "",
    vendorSku: "",
    quantity: "1",
    unitPrice: "0",
    cost: "0",
  })

  const filtered = catalog.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.sku ?? "").toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Modal maxWidth="lg">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">Add Line Item</h2>
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
                  <p className="text-xs text-muted-foreground">
                    {item.sku ?? "No SKU"} · {item.vendor?.name ?? "No vendor"} · ${item.msrp.toFixed(2)}
                  </p>
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
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        </div>
      )}

      {mode === "adhoc" && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1 text-foreground">Name *</label>
            <input
              type="text"
              value={adhoc.name}
              onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">Part #</label>
              <input
                type="text"
                value={adhoc.partNumber}
                onChange={(e) => setAdhoc({ ...adhoc, partNumber: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">Vendor</label>
              <select
                value={adhoc.vendorId}
                onChange={(e) => setAdhoc({ ...adhoc, vendorId: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">—</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">Vendor SKU</label>
              <input
                type="text"
                value={adhoc.vendorSku}
                onChange={(e) => setAdhoc({ ...adhoc, vendorSku: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">Qty</label>
              <input
                type="number"
                value={adhoc.quantity}
                onChange={(e) => setAdhoc({ ...adhoc, quantity: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">Price</label>
              <input
                type="number"
                step="0.01"
                value={adhoc.unitPrice}
                onChange={(e) => setAdhoc({ ...adhoc, unitPrice: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-foreground">Cost</label>
              <input
                type="number"
                step="0.01"
                value={adhoc.cost}
                onChange={(e) => setAdhoc({ ...adhoc, cost: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (!adhoc.name.trim()) return
                onAddAdhoc({
                  name: adhoc.name,
                  partNumber: adhoc.partNumber || undefined,
                  vendorId: adhoc.vendorId || undefined,
                  vendorSku: adhoc.vendorSku || undefined,
                  quantity: Number(adhoc.quantity) || 1,
                  unitPrice: Number(adhoc.unitPrice) || 0,
                  cost: Number(adhoc.cost) || 0,
                })
                onClose()
              }}
            >
              Add Item
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}