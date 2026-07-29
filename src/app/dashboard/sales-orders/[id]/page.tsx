"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/Modal"
import { toast } from "@/lib/toast"

interface SOLineItem {
  id: string
  name: string
  description: string | null
  sku: string | null
  section: string | null
  quantity: number
  unitPrice: number
  cost: number
  discount: number
  taxable: boolean
  isRecurring: boolean
  recurringInterval: string | null
  isTextBlock: boolean
  bundleName: string | null
  bundleDisplayMode: string | null
  isBundleHeader: boolean
  sortOrder: number
  fulfillingPOLineItems: { id: string }[]
}

interface POLineItemSummary {
  id: string
  name: string
  sku: string | null
  quantity: number
  unitCost: number
  received: boolean
}

interface PurchaseOrderSummary {
  id: string
  poNumber: string
  status: string
  vendor: { name: string }
  lineItems: POLineItemSummary[]
}

interface SalesOrderDetail {
  id: string
  soNumber: string
  status: string
  clientPoNumber: string | null
  internalNotes: string | null
  clientNotes: string | null
  shipAddress: string | null
  shipCity: string | null
  shipState: string | null
  shipZip: string | null
  shipCountry: string | null
  createdAt: string
  client: { id: string; name: string }
  user: { id: string; name: string }
  quote: { id: string; quoteNumber: string }
  lineItems: SOLineItem[]
  purchaseOrders: PurchaseOrderSummary[]
}

const STATUS_OPTIONS = [
  "DRAFT",
  "READY_TO_INVOICE",
  "INVOICED",
  "READY_TO_ORDER",
  "PARTS_ORDERED",
  "READY_TO_CLOSEOUT",
  "CLOSED",
]

const PO_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  PARTS_ORDERED: "bg-blue-100 text-blue-800",
  RECEIVED: "bg-green-100 text-green-800",
  ON_HOLD: "bg-yellow-100 text-yellow-800",
  BACKORDERED: "bg-orange-100 text-orange-800",
  CANCELLED: "bg-red-100 text-red-800",
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

function lineTotal(li: SOLineItem) {
  return li.unitPrice * li.quantity * (1 - li.discount / 100)
}

export default function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [so, setSo] = useState<SalesOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [changingStatus, setChangingStatus] = useState(false)
  const [showGeneratePO, setShowGeneratePO] = useState(false)

  function loadSO() {
    fetch(`/api/sales-orders/${id}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setSo(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadSO()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleChangeStatus(newStatus: string) {
    setChangingStatus(true)
    await fetch(`/api/sales-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    setChangingStatus(false)
    toast.success(`Status updated to ${statusLabel(newStatus)}`)
    loadSO()
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>
  if (notFound || !so) return <p className="text-sm text-red-600">Sales Order not found.</p>

  const pricedItems = so.lineItems.filter((li) => !li.isTextBlock)
  const subtotal = pricedItems.reduce((sum, li) => sum + lineTotal(li), 0)

  // Group items so bundle children render right under their header,
  // same visual pattern as the quote line item builder
  const bundleChildIds = new Set<string>()
  so.lineItems.forEach((li) => {
    if (li.isBundleHeader) {
      so.lineItems
        .filter((x) => x.bundleName === li.bundleName && !x.isBundleHeader)
        .forEach((c) => bundleChildIds.add(c.id))
    }
  })
  const orderedItems: SOLineItem[] = []
  const indentedIds = new Set<string>()
  so.lineItems.forEach((li) => {
    if (bundleChildIds.has(li.id)) return
    orderedItems.push(li)
    if (li.isBundleHeader) {
      so.lineItems
        .filter((x) => x.bundleName === li.bundleName && !x.isBundleHeader)
        .forEach((c) => {
          orderedItems.push(c)
          indentedIds.add(c.id)
        })
    }
  })

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/sales-orders" className="text-sm text-zinc-500 hover:underline inline-block mb-2">
          ← Back to Sales Orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{so.soNumber}</h1>
            <p className="text-sm text-zinc-500">
              From Quote{" "}
              <Link href={`/dashboard/quotes/${so.quote.id}`} className="hover:underline font-medium">
                {so.quote.quoteNumber}
              </Link>
            </p>
          </div>
          <select
            value={so.status}
            onChange={(e) => handleChangeStatus(e.target.value)}
            disabled={changingStatus}
            className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 border-0"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: main content */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-md border p-4 space-y-1 text-sm">
            <p><span className="text-zinc-500">Client:</span> {so.client.name}</p>
            <p><span className="text-zinc-500">Owner:</span> {so.user.name}</p>
            <p><span className="text-zinc-500">Client PO #:</span> {so.clientPoNumber ?? "—"}</p>
            <p><span className="text-zinc-500">Created:</span> {new Date(so.createdAt).toLocaleDateString()}</p>
          </div>

          <div className="rounded-md border p-4 space-y-1 text-sm">
            <h2 className="font-semibold text-sm mb-1">Shipping Address</h2>
            <p>{so.shipAddress ?? "—"}</p>
            <p>{[so.shipCity, so.shipState, so.shipZip].filter(Boolean).join(", ")}</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Line Items</h2>
              <Button size="sm" onClick={() => setShowGeneratePO(true)}>
                + Generate Purchase Order
              </Button>
            </div>

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-xs text-zinc-500">
                    <th className="py-2 pl-4">Part #</th>
                    <th className="py-2">Description</th>
                    <th className="py-2 w-16">Qty</th>
                    <th className="py-2 w-24">Unit Price</th>
                    <th className="py-2 w-24 pr-4">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedItems.map((li) => {
                    const indent = indentedIds.has(li.id)

                    if (li.isBundleHeader) {
                      return (
                        <tr key={li.id} className="border-b bg-purple-50 dark:bg-purple-950/30">
                          <td className="py-2 pl-4" colSpan={5}>
                            <span className="text-xs font-semibold text-purple-600 dark:text-purple-300">
                              📦 {li.name}
                            </span>
                            <span className="ml-2 text-xs text-zinc-400">
                              ({li.bundleDisplayMode === "ITEMIZED" ? "itemized" : "combined price"})
                            </span>
                          </td>
                        </tr>
                      )
                    }

                    if (li.isTextBlock) {
                      return (
                        <tr key={li.id} className="border-b last:border-0">
                          <td className="py-2 pl-4 font-medium" colSpan={5}>{li.name}</td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={li.id} className="border-b last:border-0">
                        <td className={`py-2 ${indent ? "pl-10" : "pl-4"}`}>{li.sku ?? "—"}</td>
                        <td className="py-2">
                          {li.bundleName && (
                            <p className="text-xs text-purple-500">📦 in {li.bundleName}</p>
                          )}
                          {li.name}
                        </td>
                        <td className="py-2">{li.quantity}</td>
                        <td className="py-2">{money(li.unitPrice)}</td>
                        <td className="py-2 pr-4 font-medium">{money(lineTotal(li))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="rounded-md border p-3 text-sm">
                <span className="text-zinc-500 mr-3">Subtotal</span>
                <span className="font-semibold">{money(subtotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Purchase Orders */}
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">Purchase Orders</h2>
          {so.purchaseOrders.length === 0 && (
            <p className="text-sm text-zinc-500">No Purchase Orders generated yet.</p>
          )}
          {so.purchaseOrders.map((po) => (
            <div key={po.id} className="rounded-md border overflow-hidden">
              <Link
                href={`/dashboard/purchase-orders/${po.id}`}
                className="flex items-center justify-between p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b"
              >
                <span>
                  <span className="font-medium">{po.poNumber}</span>
                  <span className="text-zinc-500 block text-xs">{po.vendor.name}</span>
                </span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${PO_STATUS_COLORS[po.status]}`}>
                  {statusLabel(po.status)}
                </span>
              </Link>
              <div className="divide-y">
                {po.lineItems.map((li) => (
                  <div key={li.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="flex items-center gap-2">
                      {li.received ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-zinc-300">○</span>
                      )}
                      {li.name} {li.sku && <span className="text-zinc-400">({li.sku})</span>}
                    </span>
                    <span className="text-zinc-500">Qty {li.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showGeneratePO && (
        <GeneratePOModal
          salesOrderId={id}
          lineItems={so.lineItems}
          onClose={() => setShowGeneratePO(false)}
          onCreated={(poId) => router.push(`/dashboard/purchase-orders/${poId}`)}
        />
      )}
    </div>
  )
}

// ─── Generate PO Modal ────────────────────────────────────────────────────
interface VendorOption {
  id: string
  name: string
}

function GeneratePOModal({
  salesOrderId,
  lineItems,
  onClose,
  onCreated,
}: {
  salesOrderId: string
  lineItems: SOLineItem[]
  onClose: () => void
  onCreated: (poId: string) => void
}) {
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorId, setVendorId] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")

  // Only real, orderable items can go on a PO — not bundle headers or text
  // blocks (display-only groupings/notes), and not anything already
  // assigned to an earlier PO for this SO
  const orderableItems = lineItems.filter(
    (li) => !li.isBundleHeader && !li.isTextBlock && li.fulfillingPOLineItems.length === 0
  )

  useEffect(() => {
    fetch("/api/vendors")
      .then((res) => res.json())
      .then((data: VendorOption[]) => setVendors(data))
  }, [])

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === orderableItems.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(orderableItems.map((li) => li.id)))
    }
  }

  async function handleCreate() {
    if (!vendorId || selected.size === 0) return
    setCreating(true)
    setError("")

    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        soLineItemIds: Array.from(selected),
      }),
    })
    const data = await res.json()
    setCreating(false)

    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      return
    }

    toast.success(`Purchase Order ${data.poNumber ?? ""} created`.trim())
    onCreated(data.id)
  }

  return (
    <Modal maxWidth="lg" scrollable>
      <h2 className="text-lg font-bold">Generate Purchase Order</h2>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Vendor *</label>
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Select a vendor...</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Line Items to Order</label>
          <button onClick={toggleAll} className="text-xs text-zinc-500 hover:underline">
            {selected.size === orderableItems.length ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto rounded-md border p-2">
          {orderableItems.map((li) => (
            <label
              key={li.id}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={selected.has(li.id)}
                onChange={() => toggleItem(li.id)}
              />
              <span className="flex-1">
                {li.bundleName && (
                  <span className="text-xs text-purple-500 block">📦 in {li.bundleName}</span>
                )}
                {li.name} {li.sku && <span className="text-zinc-400">({li.sku})</span>}
              </span>
              <span className="text-zinc-500">Qty {li.quantity}</span>
            </label>
          ))}
          {orderableItems.length === 0 && (
            <p className="text-sm text-zinc-500 px-2 py-2">No orderable items on this Sales Order.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={creating}>Cancel</Button>
        <Button onClick={handleCreate} disabled={creating || !vendorId || selected.size === 0}>
          {creating ? "Creating..." : "Create Purchase Order"}
        </Button>
      </div>
    </Modal>
  )
}