"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { LineItemTable, MoveButtons, RowActionsRead, RowActionsEdit, CopyableCell, money, type ColumnDef } from "@/components/line-items/LineItemTableShell"
import { AddLineItemModal } from "@/components/line-items/AddLineItemModal"

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
  vendorSku: string | null
  manufacturerSku: string | null
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

function typeLabel(li: SOLineItemBuilderItem) {
  if (!li.isRecurring) return "One-time"
  if (!li.recurringInterval) return "Recurring"
  return `Recurring (${li.recurringInterval.charAt(0) + li.recurringInterval.slice(1).toLowerCase()})`
}

const COLUMNS: ColumnDef[] = [
  { header: "", widthPct: 3 },
  { header: "Part #", widthPct: 8 },
  { header: "Description", widthPct: 22 },
  { header: "Vendor", widthPct: 11 },
  { header: "Vendor SKU", widthPct: 9 },
  { header: "Qty", widthPct: 5, align: "right" },
  { header: "Cost", widthPct: 7, align: "right" },
  { header: "Price", widthPct: 7, align: "right" },
  { header: "Discount", widthPct: 6, align: "right" },
  { header: "Total", widthPct: 7, align: "right" },
  { header: "Type", widthPct: 8 },
  { header: "", widthPct: 7 },
]

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
  const [adhoc, setAdhoc] = useState({
    name: "", partNumber: "", vendorId: "", vendorSku: "", quantity: "1", unitPrice: "0", cost: "0",
  })

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
    await Promise.all([onUpdate(a.id, { sortOrder: b.sortOrder }), onUpdate(b.id, { sortOrder: a.sortOrder })])
  }

  async function moveBundleChild(bundleName: string, id: string, direction: "up" | "down") {
    const children = childrenOf(bundleName)
    const idx = children.findIndex((li) => li.id === id)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= children.length) return
    const a = children[idx]
    const b = children[swapIdx]
    await Promise.all([onUpdate(a.id, { sortOrder: b.sortOrder }), onUpdate(b.id, { sortOrder: a.sortOrder })])
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmDialog({ title: "Remove this line item?", confirmLabel: "Remove", variant: "danger" })
    if (!confirmed) return
    await onDelete(id)
  }

  async function handleAddBundle() {
    const bundleName = await promptDialog({ title: "Name this bundle", placeholder: 'e.g. "Starter Kit"' })
    if (!bundleName) return
    await onCreate({ name: bundleName.trim(), bundleName: bundleName.trim(), isBundleHeader: true })
  }

  function openAdd(bundleName: string | null) {
    setAddToBundleName(bundleName)
    setAdhoc({ name: "", partNumber: "", vendorId: "", vendorSku: "", quantity: "1", unitPrice: "0", cost: "0" })
    setShowAddModal(true)
  }

  function renderRow(li: SOLineItemBuilderItem, isChild: boolean) {
    const total = lineTotal(li)
    const isEditing = editingId === li.id
    const partNumberValue = li.partNumber ?? li.sku ?? ""

    return (
      <tr key={li.id} className={`border-b border-border last:border-0 ${isChild ? "bg-muted/40" : ""}`}>
        <td className={`py-2 pr-1 align-top ${isChild ? "pl-8" : "pl-4"}`}>
          {!locked && (
            <MoveButtons
              onUp={() => (isChild ? moveBundleChild(li.bundleName!, li.id, "up") : moveTopLevel(li.id, "up"))}
              onDown={() => (isChild ? moveBundleChild(li.bundleName!, li.id, "down") : moveTopLevel(li.id, "down"))}
            />
          )}
        </td>

        {isEditing ? (
          <>
            <td className="py-2 pr-2 align-top">
              <input type="text" defaultValue={partNumberValue} onBlur={(e) => onUpdate(li.id, { partNumber: e.target.value })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground" />
            </td>
            <td className="py-2 pr-2 align-top">
              <input type="text" defaultValue={li.name} onBlur={(e) => onUpdate(li.id, { name: e.target.value })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-medium text-foreground" />
              <input type="text" defaultValue={li.description ?? ""} placeholder="Description" onBlur={(e) => onUpdate(li.id, { description: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground" />
            </td>
            <td className="py-2 pr-2 align-top">
              <select value={li.vendorId ?? ""} onChange={(e) => onUpdate(li.id, { vendorId: e.target.value || null })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground">
                <option value="">—</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </td>
            <td className="py-2 pr-2 align-top">
              <input type="text" defaultValue={li.vendorSku ?? ""} onBlur={(e) => onUpdate(li.id, { vendorSku: e.target.value })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground" />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input type="number" defaultValue={li.quantity} onBlur={(e) => onUpdate(li.id, { quantity: Number(e.target.value) })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-right text-foreground tabular-nums" />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input type="number" step="0.01" defaultValue={li.cost} onBlur={(e) => onUpdate(li.id, { cost: Number(e.target.value) })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-right text-foreground tabular-nums" />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input type="number" step="0.01" defaultValue={li.unitPrice} onBlur={(e) => onUpdate(li.id, { unitPrice: Number(e.target.value) })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-right text-foreground tabular-nums" />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input type="number" step="1" defaultValue={li.discount} onBlur={(e) => onUpdate(li.id, { discount: Number(e.target.value) })} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-right text-foreground tabular-nums" />
            </td>
            <td className="py-2 pr-2 align-top text-right font-medium text-foreground tabular-nums">{money(total)}</td>
            <td className="py-2 pr-2 align-top">
              <select value={typeValueOf(li)} onChange={(e) => onUpdate(li.id, typePatchFor(e.target.value as TypeValue))} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground">
                <option value="ONE_TIME">One-time</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUALLY">Annually</option>
              </select>
            </td>
            <td className="py-2 pr-4 align-top">
              <RowActionsEdit onDone={() => setEditingId(null)} onDuplicate={() => onDuplicate(li)} onDelete={() => handleDelete(li.id)} />
            </td>
          </>
        ) : (
          <>
            <td className="py-2 pr-2 align-top text-muted-foreground"><CopyableCell value={partNumberValue || null} /></td>
            <td className="py-2 pr-2 align-top">
              {li.bundleName && <p className="text-xs text-primary">📦 in {li.bundleName}</p>}
              <span className="text-foreground">{li.name}</span>
              {li.description && <p className="text-xs text-muted-foreground truncate">{li.description}</p>}
            </td>
            <td className="py-2 pr-2 align-top text-muted-foreground truncate">{li.vendor?.name ?? "—"}</td>
            <td className="py-2 pr-2 align-top text-muted-foreground"><CopyableCell value={li.vendorSku} /></td>
            <td className="py-2 pr-2 align-top text-right text-foreground tabular-nums">{li.quantity}</td>
            <td className="py-2 pr-2 align-top text-right text-muted-foreground tabular-nums">{money(li.cost)}</td>
            <td className="py-2 pr-2 align-top text-right text-foreground tabular-nums">{money(li.unitPrice)}</td>
            <td className="py-2 pr-2 align-top text-right text-muted-foreground tabular-nums">{li.discount ? `${li.discount}%` : "—"}</td>
            <td className="py-2 pr-2 align-top text-right font-medium text-foreground tabular-nums">{money(total)}</td>
            <td className="py-2 pr-2 align-top text-muted-foreground truncate">{typeLabel(li)}</td>
            <td className="py-2 pr-4 align-top">
              {!locked && <RowActionsRead onEdit={() => setEditingId(li.id)} onDuplicate={() => onDuplicate(li)} onDelete={() => handleDelete(li.id)} />}
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

      <LineItemTable columns={COLUMNS}>
        {topLevel.map((li) => {
          if (li.isBundleHeader) {
            const children = childrenOf(li.bundleName!)
            return (
              <>
                <tr key={li.id} className="border-b border-border bg-primary/5">
                  <td className="py-2 pl-4" colSpan={COLUMNS.length}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-primary">📦</span>
                      <input type="text" defaultValue={li.name} disabled={locked} onBlur={(e) => onUpdate(li.id, { name: e.target.value })} className="rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-semibold text-foreground" />
                      <select value={li.bundleDisplayMode ?? "COLLAPSED"} disabled={locked} onChange={(e) => onUpdate(li.id, { bundleDisplayMode: e.target.value })} className="rounded-md border border-border bg-background px-1 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-foreground">
                        <option value="COLLAPSED">Combined price</option>
                        <option value="ITEMIZED">Itemized</option>
                      </select>
                      {!locked && (
                        <>
                          <button onClick={() => openAdd(li.bundleName)} className="text-xs text-primary hover:underline">+ Add Item to Bundle</button>
                          <button onClick={() => handleDelete(li.id)} title="Delete bundle (items inside stay)" className="text-xs text-danger hover:underline ml-auto">✕</button>
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
            <td colSpan={COLUMNS.length} className="py-6 text-center text-muted-foreground">No line items yet.</td>
          </tr>
        )}
      </LineItemTable>

      {showAddModal && (
        <AddLineItemModal
          catalog={catalog}
          catalogSubtitle={(item) => `${item.manufacturerSku ?? item.vendorSku ?? "No SKU"} · ${item.vendor?.name ?? "No vendor"} · $${item.msrp.toFixed(2)}`}
          onClose={() => { setShowAddModal(false); setAddToBundleName(null) }}
          onAddCatalog={(item, quantity) =>
            onCreate({
              catalogItemId: item.id,
              name: item.name,
              partNumber: item.manufacturerSku ?? item.vendorSku ?? undefined,
              vendorId: item.vendorId ?? undefined,
              vendorSku: item.vendorSku ?? undefined,
              unitPrice: item.msrp,
              cost: item.cost,
              taxable: item.taxable,
              quantity,
              bundleName: addToBundleName ?? undefined,
            })
          }
          adhocForm={
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 text-foreground">Name *</label>
                <input type="text" value={adhoc.name} onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Part #</label>
                  <input type="text" value={adhoc.partNumber} onChange={(e) => setAdhoc({ ...adhoc, partNumber: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Vendor</label>
                  <select value={adhoc.vendorId} onChange={(e) => setAdhoc({ ...adhoc, vendorId: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">—</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Vendor SKU</label>
                  <input type="text" value={adhoc.vendorSku} onChange={(e) => setAdhoc({ ...adhoc, vendorSku: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Qty</label>
                  <input type="number" value={adhoc.quantity} onChange={(e) => setAdhoc({ ...adhoc, quantity: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Price</label>
                  <input type="number" step="0.01" value={adhoc.unitPrice} onChange={(e) => setAdhoc({ ...adhoc, unitPrice: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Cost</label>
                  <input type="number" step="0.01" value={adhoc.cost} onChange={(e) => setAdhoc({ ...adhoc, cost: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    if (!adhoc.name.trim()) return
                    onCreate({
                      name: adhoc.name,
                      partNumber: adhoc.partNumber || undefined,
                      vendorId: adhoc.vendorId || undefined,
                      vendorSku: adhoc.vendorSku || undefined,
                      quantity: Number(adhoc.quantity) || 1,
                      unitPrice: Number(adhoc.unitPrice) || 0,
                      cost: Number(adhoc.cost) || 0,
                      bundleName: addToBundleName ?? undefined,
                    })
                    setShowAddModal(false)
                    setAddToBundleName(null)
                  }}
                >
                  Add Item
                </Button>
              </div>
            </div>
          }
        />
      )}
    </div>
  )
}