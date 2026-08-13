"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { TabsBar } from "@/components/ui/tabs-bar"
import { Package, FileClock } from "lucide-react"

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "user", label: "User" },
  { value: "device", label: "Device" },
  { value: "gb", label: "GB" },
  { value: "license", label: "License" },
]

function unitLabel(value: string) {
  return UNIT_OPTIONS.find((u) => u.value === value)?.label ?? value
}

interface CatalogItemDetail {
  id: string
  name: string
  description: string | null
  category: string | null
  subcategory: string | null
  type: string
  msrp: number
  cost: number
  unit: string
  taxable: boolean
  active: boolean
  vendorId: string | null
  vendorSku: string | null
  manufacturerId: string | null
  manufacturerSku: string | null
}

interface VendorOption {
  id: string
  name: string
  isVendor: boolean
  isManufacturer: boolean
}

interface OrderHistoryRow {
  id: string
  soId: string
  soNumber: string
  status: string
  clientName: string
  quantity: number
  unitPrice: number
  createdAt: string
}

interface ChangeLogRow {
  id: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  createdAt: string
  changedByUser: { name: string }
}

type ItemTabKey = "details" | "orderHistory" | "linkedAssets" | "changeLog"

const ITEM_TABS: { key: ItemTabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "orderHistory", label: "Order History" },
  { key: "linkedAssets", label: "Linked Assets" },
  { key: "changeLog", label: "Change Log" },
]

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

function money(n: number) {
  return `$${n.toFixed(2)}`
}

export default function CatalogItemDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [item, setItem] = useState<CatalogItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CatalogItemDetail | null>(null)
  const [activeTab, setActiveTab] = useState<ItemTabKey>("details")

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [orderHistory, setOrderHistory] = useState<OrderHistoryRow[]>([])
  const [changeLog, setChangeLog] = useState<ChangeLogRow[]>([])

  function loadItem() {
    fetch(`/api/catalog/${id}`)
      .then((res) => res.json())
      .then((json) => {
        setItem(json)
        setLoading(false)
      })
  }

  function loadChangeLog() {
    fetch(`/api/catalog/${id}/change-log`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setChangeLog(data))
  }

  useEffect(() => {
    loadItem()
    loadChangeLog()
    fetch(`/api/catalog/${id}/order-history`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setOrderHistory(data))
    fetch("/api/vendors")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setVendors(data))
  }, [id])

  function startEditing() {
    if (!item) return
    setDraft({ ...item })
    setEditing(true)
  }

  function updateDraft(field: keyof CatalogItemDetail, value: string | number | boolean) {
    setDraft((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)

    const res = await fetch(`/api/catalog/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })

    setSaving(false)
    if (res.ok) {
      toast.success("Item saved")
      setEditing(false)
      loadItem()
      loadChangeLog()
    } else {
      toast.error("Couldn't save item")
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!item) {
    return <p className="text-sm text-danger">Item not found.</p>
  }

  const vendorOptions = vendors.filter((v) => v.isVendor)
  const manufacturerOptions = vendors.filter((v) => v.isManufacturer)
  const vendorName = vendors.find((v) => v.id === item.vendorId)?.name
  const manufacturerName = vendors.find((v) => v.id === item.manufacturerId)?.name

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/catalog" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-block mb-2">
          ← Back to Catalog
        </Link>
        <h1 className="text-display font-semibold tracking-tight text-foreground">{item.name}</h1>
      </div>

      <TabsBar tabs={ITEM_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Catalog item sections" />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "details" && (
          <div className="max-w-2xl space-y-4">
            <div className="flex justify-end gap-2">
              {editing ? (
                <>
                  <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
                </>
              ) : (
                <Button variant="outline" onClick={startEditing}>Edit</Button>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3 text-sm">
              {!editing ? (
                <>
                  <p><span className="font-medium text-foreground">Item Name:</span> <span className="text-muted-foreground">{item.name}</span></p>
                  <p><span className="font-medium text-foreground">Description:</span> <span className="text-muted-foreground">{item.description || "—"}</span></p>
                  <p><span className="font-medium text-foreground">Type:</span> <span className="text-muted-foreground">{item.type}</span></p>
                  <p><span className="font-medium text-foreground">Category:</span> <span className="text-muted-foreground">{item.category || "—"}</span></p>
                  <p><span className="font-medium text-foreground">Subcategory:</span> <span className="text-muted-foreground">{item.subcategory || "—"}</span></p>
                  <p><span className="font-medium text-foreground">Cost Price:</span> <span className="text-muted-foreground">{money(item.cost)}</span></p>
                  <p><span className="font-medium text-foreground">MSRP:</span> <span className="text-muted-foreground">{money(item.msrp)}</span></p>
                  <p><span className="font-medium text-foreground">Billing Unit:</span> <span className="text-muted-foreground">{unitLabel(item.unit)}</span></p>
                  <p><span className="font-medium text-foreground">Taxable:</span> <span className="text-muted-foreground">{item.taxable ? "Yes" : "No"}</span></p>
                  <p><span className="font-medium text-foreground">Active:</span> <span className="text-muted-foreground">{item.active ? "Yes" : "No"}</span></p>
                  <p><span className="font-medium text-foreground">Vendor:</span> <span className="text-muted-foreground">{vendorName || "—"}</span></p>
                  <p><span className="font-medium text-foreground">Vendor SKU:</span> <span className="text-muted-foreground">{item.vendorSku || "—"}</span></p>
                  <p><span className="font-medium text-foreground">Manufacturer:</span> <span className="text-muted-foreground">{manufacturerName || "—"}</span></p>
                  <p><span className="font-medium text-foreground">Manufacturer SKU:</span> <span className="text-muted-foreground">{item.manufacturerSku || "—"}</span></p>
                </>
              ) : draft && (
                <>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Item Name</label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(e) => updateDraft("name", e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Description</label>
                    <textarea
                      value={draft.description ?? ""}
                      onChange={(e) => updateDraft("description", e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Type</label>
                      <select
                        value={draft.type}
                        onChange={(e) => updateDraft("type", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="PHYSICAL">Physical</option>
                        <option value="SERVICE">Service</option>
                        <option value="SUBSCRIPTION">Subscription</option>
                        <option value="BUNDLE">Bundle</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Billing Unit</label>
                      <select
                        value={draft.unit}
                        onChange={(e) => updateDraft("unit", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u.value} value={u.value}>{u.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Category</label>
                      <input
                        type="text"
                        value={draft.category ?? ""}
                        onChange={(e) => updateDraft("category", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Subcategory</label>
                      <input
                        type="text"
                        value={draft.subcategory ?? ""}
                        onChange={(e) => updateDraft("subcategory", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Cost Price ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={draft.cost}
                        onChange={(e) => updateDraft("cost", Number(e.target.value))}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">MSRP ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={draft.msrp}
                        onChange={(e) => updateDraft("msrp", Number(e.target.value))}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.taxable}
                        onChange={(e) => updateDraft("taxable", e.target.checked)}
                        className="accent-primary"
                      />
                      Taxable
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.active}
                        onChange={(e) => updateDraft("active", e.target.checked)}
                        className="accent-primary"
                      />
                      Active
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Vendor</label>
                      <select
                        value={draft.vendorId ?? ""}
                        onChange={(e) => updateDraft("vendorId", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Not set</option>
                        {vendorOptions.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Vendor SKU</label>
                      <input
                        type="text"
                        value={draft.vendorSku ?? ""}
                        onChange={(e) => updateDraft("vendorSku", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Manufacturer</label>
                      <select
                        value={draft.manufacturerId ?? ""}
                        onChange={(e) => updateDraft("manufacturerId", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Not set</option>
                        {manufacturerOptions.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Manufacturer SKU</label>
                      <input
                        type="text"
                        value={draft.manufacturerSku ?? ""}
                        onChange={(e) => updateDraft("manufacturerSku", e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === "orderHistory" && (
          <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-caption text-muted-foreground">
                  <th className="py-2 pl-4 pr-3">SO Number</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Unit Price</th>
                  <th className="py-2 pr-4">Date</th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="py-2 pl-4 pr-3">
                      <Link href={`/dashboard/sales-orders/${row.soId}`} className="text-primary hover:underline font-medium">
                        {row.soNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-foreground">{row.clientName}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[row.status]}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right text-foreground tabular-nums">{row.quantity}</td>
                    <td className="py-2 pr-3 text-right text-foreground tabular-nums">{money(row.unitPrice)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {orderHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      This item hasn&apos;t been sold on any Sales Order yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "linkedAssets" && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
            <Package className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-foreground">Linked Assets coming soon</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Tracked units of this item deployed at client sites will show here once the inventory/asset tracking system is built.
            </p>
          </div>
        )}

        {activeTab === "changeLog" && (
          <div className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
            {changeLog.length === 0 ? (
              <div className="p-10 text-center">
                <FileClock className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">No changes recorded yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {changeLog.map((log) => (
                  <div key={log.id} className="p-3 text-sm">
                    <p className="text-foreground">
                      <span className="font-medium">{log.changedByUser.name}</span> changed{" "}
                      <span className="font-medium">{log.fieldName}</span> from{" "}
                      <span className="text-muted-foreground">&quot;{log.oldValue}&quot;</span> to{" "}
                      <span className="text-muted-foreground">&quot;{log.newValue}&quot;</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{new Date(log.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}