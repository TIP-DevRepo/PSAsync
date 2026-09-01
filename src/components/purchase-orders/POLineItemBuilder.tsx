"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { confirmDialog } from "@/lib/confirm-dialog"
import { LineItemTable, MoveButtons, RowActionsRead, RowActionsEdit, CopyableCell, money, type ColumnDef } from "@/components/line-items/LineItemTableShell"
import { AddLineItemModal } from "@/components/line-items/AddLineItemModal"
import { ReceiveModal, type ReceivePayload, type ReceivableLineItem } from "@/components/purchase-orders/ReceiveModal"
import type { LocationPathOption } from "@/lib/inventory/locationPaths"

// ─── Types ────────────────────────────────────────────────────────────────
export interface POLineItemBuilderItem {
  id: string
  catalogItemId: string | null
  catalogItem: { isSerialized: boolean; type: string } | null
  partNumber: string | null
  sku: string | null
  vendorSku: string | null
  name: string
  description: string | null
  quantity: number
  unitCost: number
  serialNumber: string | null
  received: boolean
  sortOrder: number
}

export interface POCatalogOption {
  id: string
  name: string
  vendorSku: string | null
  manufacturerSku: string | null
  cost: number
}

function lineTotal(li: POLineItemBuilderItem) {
  return li.unitCost * li.quantity
}

// A line item only goes through Inventory receiving if it's linked to a
// Catalog Item AND that item's type is Physical — Services, Subscriptions,
// and Bundles have nothing to track a physical unit or stock quantity for.
function isInventoryTracked(li: POLineItemBuilderItem): boolean {
  return li.catalogItemId !== null && li.catalogItem?.type === "PHYSICAL"
}

const COLUMNS: ColumnDef[] = [
  { header: "", widthPct: 4 },
  { header: "Part #", widthPct: 9 },
  { header: "Description", widthPct: 22 },
  { header: "Vendor SKU", widthPct: 9 },
  { header: "Qty", widthPct: 7, align: "right" },
  { header: "Cost", widthPct: 9, align: "right" },
  { header: "Total", widthPct: 9, align: "right" },
  { header: "Serial #", widthPct: 12 },
  { header: "Rcv'd", widthPct: 6, align: "center" },
  { header: "", widthPct: 8 },
]

interface POLineItemBuilderProps {
  items: POLineItemBuilderItem[]
  catalog: POCatalogOption[]
  locked?: boolean
  shipToClient: boolean
  receivingClientLocationId: string | null
  receivingClientLocationName: string | null
  companyLocationOptions: LocationPathOption[]
  clientLocationOptions: LocationPathOption[]
  onCreate: (payload: Partial<POLineItemBuilderItem>) => void | Promise<void>
  onUpdate: (id: string, patch: Partial<POLineItemBuilderItem>) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onDuplicate: (li: POLineItemBuilderItem) => void | Promise<void>
  onReceiveMany: (receipts: { lineItemId: string; payload: ReceivePayload }[]) => Promise<{ ok: boolean; error?: string }>
}

export function POLineItemBuilder({
  items,
  catalog,
  locked = false,
  shipToClient,
  receivingClientLocationId,
  receivingClientLocationName,
  companyLocationOptions,
  clientLocationOptions,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
  onReceiveMany,
}: POLineItemBuilderProps) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adhoc, setAdhoc] = useState({ name: "", partNumber: "", vendorSku: "", quantity: "1", unitCost: "0" })
  const [receiveQueue, setReceiveQueue] = useState<POLineItemBuilderItem[] | null>(null)

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder)

  async function move(id: string, direction: "up" | "down") {
    const idx = sorted.findIndex((li) => li.id === id)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swapIdx]
    await Promise.all([onUpdate(a.id, { sortOrder: b.sortOrder }), onUpdate(b.id, { sortOrder: a.sortOrder })])
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmDialog({ title: "Remove this line item?", confirmLabel: "Remove", variant: "danger" })
    if (!confirmed) return
    await onDelete(id)
  }

  function openAdd() {
    setAdhoc({ name: "", partNumber: "", vendorSku: "", quantity: "1", unitCost: "0" })
    setShowAddModal(true)
  }

  async function handleReceiveAll() {
    const unreceived = sorted.filter((li) => !li.received)
    const simple = unreceived.filter((li) => !isInventoryTracked(li))
    const tracked = unreceived.filter((li) => isInventoryTracked(li))

    // Non-inventory-tracked items (services, ad-hoc rows, etc) just get
    // marked received directly — there's nothing to collect for them.
    await Promise.all(simple.map((li) => onUpdate(li.id, { received: true })))

    if (tracked.length > 0) {
      setReceiveQueue(tracked)
    }
  }

  function renderReceivedCell(li: POLineItemBuilderItem) {
    if (li.received) {
      return <span className="text-xs font-medium text-success">✓ Received</span>
    }
    if (!isInventoryTracked(li)) {
      return (
        <input
          type="checkbox"
          checked={li.received}
          onChange={(e) => onUpdate(li.id, { received: e.target.checked })}
        />
      )
    }
    return (
      <button onClick={() => setReceiveQueue([li])} className="text-xs font-medium text-primary hover:underline">
        Receive
      </button>
    )
  }

  function renderRow(li: POLineItemBuilderItem) {
    const total = lineTotal(li)
    const isEditing = editingId === li.id
    const partNumberValue = li.partNumber ?? li.sku ?? ""
    const showSerialColumn = isInventoryTracked(li) && li.catalogItem?.isSerialized

    return (
      <tr key={li.id} className="border-b border-border last:border-0">
        <td className="py-2 pl-4 pr-1 align-top">
          {!locked && <MoveButtons onUp={() => move(li.id, "up")} onDown={() => move(li.id, "down")} />}
        </td>

        {isEditing ? (
          <>
            <td className="py-2 pr-2 align-top">
              <input type="text" defaultValue={partNumberValue} onBlur={(e) => onUpdate(li.id, { partNumber: e.target.value })} className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground" />
            </td>
            <td className="py-2 pr-2 align-top">
              <input type="text" defaultValue={li.name} onBlur={(e) => onUpdate(li.id, { name: e.target.value })} className="w-full rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground" />
              <input type="text" defaultValue={li.description ?? ""} placeholder="Description" onBlur={(e) => onUpdate(li.id, { description: e.target.value })} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground" />
            </td>
            <td className="py-2 pr-2 align-top">
              <input type="text" defaultValue={li.vendorSku ?? ""} onBlur={(e) => onUpdate(li.id, { vendorSku: e.target.value })} className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground" />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input type="number" defaultValue={li.quantity} onBlur={(e) => onUpdate(li.id, { quantity: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-right text-foreground tabular-nums" />
            </td>
            <td className="py-2 pr-2 align-top text-right">
              <input type="number" step="0.01" defaultValue={li.unitCost} onBlur={(e) => onUpdate(li.id, { unitCost: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-right text-foreground tabular-nums" />
            </td>
            <td className="py-2 pr-2 align-top text-right font-medium text-foreground tabular-nums">{money(total)}</td>
            <td className="py-2 pr-2 align-top">
              {showSerialColumn ? (
                <span className="text-xs text-muted-foreground">Set during receiving</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 pr-2 align-top text-center">{renderReceivedCell(li)}</td>
            <td className="py-2 pr-4 align-top">
              <RowActionsEdit onDone={() => setEditingId(null)} onDuplicate={() => onDuplicate(li)} onDelete={() => handleDelete(li.id)} />
            </td>
          </>
        ) : (
          <>
            <td className="py-2 pr-2 align-top text-muted-foreground"><CopyableCell value={partNumberValue || null} /></td>
            <td className="py-2 pr-2 align-top">
              <span className="text-foreground">{li.name}</span>
              {li.description && <p className="text-xs text-muted-foreground truncate">{li.description}</p>}
            </td>
            <td className="py-2 pr-2 align-top text-muted-foreground"><CopyableCell value={li.vendorSku} /></td>
            <td className="py-2 pr-2 align-top text-right text-foreground tabular-nums">{li.quantity}</td>
            <td className="py-2 pr-2 align-top text-right text-muted-foreground tabular-nums">{money(li.unitCost)}</td>
            <td className="py-2 pr-2 align-top text-right font-medium text-foreground tabular-nums">{money(total)}</td>
            <td className="py-2 pr-2 align-top">
              {showSerialColumn ? (
                <span className="text-xs text-muted-foreground">{li.received ? "See asset" : "Set during receiving"}</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 pr-2 align-top text-center">{renderReceivedCell(li)}</td>
            <td className="py-2 pr-4 align-top">
              {!locked && <RowActionsRead onEdit={() => setEditingId(li.id)} onDuplicate={() => onDuplicate(li)} onDelete={() => handleDelete(li.id)} />}
            </td>
          </>
        )}
      </tr>
    )
  }

  const anyUnreceived = sorted.some((li) => !li.received)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {!locked && <Button size="sm" variant="outline" onClick={openAdd}>+ Add Line Item</Button>}
        {!locked && anyUnreceived && (
          <Button size="sm" onClick={handleReceiveAll}>Receive All</Button>
        )}
      </div>

      <LineItemTable columns={COLUMNS}>
        {sorted.map((li) => renderRow(li))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={COLUMNS.length} className="py-6 text-center text-muted-foreground">No line items yet.</td>
          </tr>
        )}
      </LineItemTable>

      {showAddModal && (
        <AddLineItemModal
          catalog={catalog}
          catalogSubtitle={(item) => `${item.manufacturerSku ?? item.vendorSku ?? "No SKU"} · $${item.cost.toFixed(2)}`}
          onClose={() => setShowAddModal(false)}
          onAddCatalog={(item, quantity) =>
            onCreate({ catalogItemId: item.id, name: item.name, partNumber: item.manufacturerSku ?? item.vendorSku ?? undefined, vendorSku: item.vendorSku ?? undefined, unitCost: item.cost, quantity })
          }
          adhocForm={
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 text-foreground">Name *</label>
                <input type="text" value={adhoc.name} onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Part #</label>
                  <input type="text" value={adhoc.partNumber} onChange={(e) => setAdhoc({ ...adhoc, partNumber: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Vendor SKU</label>
                  <input type="text" value={adhoc.vendorSku} onChange={(e) => setAdhoc({ ...adhoc, vendorSku: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Qty</label>
                  <input type="number" value={adhoc.quantity} onChange={(e) => setAdhoc({ ...adhoc, quantity: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-foreground">Cost</label>
                  <input type="number" step="0.01" value={adhoc.unitCost} onChange={(e) => setAdhoc({ ...adhoc, unitCost: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    if (!adhoc.name.trim()) return
                    onCreate({
                      name: adhoc.name,
                      partNumber: adhoc.partNumber || undefined,
                      vendorSku: adhoc.vendorSku || undefined,
                      quantity: Number(adhoc.quantity) || 1,
                      unitCost: Number(adhoc.unitCost) || 0,
                    })
                    setShowAddModal(false)
                  }}
                >
                  Add Item
                </Button>
              </div>
            </div>
          }
        />
      )}

      {receiveQueue && (
        <ReceiveModal
          lineItems={receiveQueue.map<ReceivableLineItem>((li) => ({
            id: li.id,
            name: li.name,
            quantity: li.quantity,
            isSerialized: li.catalogItem?.isSerialized ?? false,
          }))}
          shipToClient={shipToClient}
          receivingClientLocationId={receivingClientLocationId}
          receivingClientLocationName={receivingClientLocationName}
          companyLocationOptions={companyLocationOptions}
          clientLocationOptions={clientLocationOptions}
          onSubmit={onReceiveMany}
          onClose={() => setReceiveQueue(null)}
        />
      )}
    </div>
  )
}