"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface POLineItem {
  id: string
  name: string
  description: string | null
  sku: string | null
  quantity: number
  unitCost: number
  serialNumber: string | null
  received: boolean
  sortOrder: number
}

interface Shipment {
  id: string
  carrier: string | null
  trackingNumber: string | null
  shippedAt: string | null
  notes: string | null
}

interface PODetail {
  id: string
  poNumber: string
  status: string
  paymentType: string
  internalNotes: string | null
  sentAt: string | null
  expectedAt: string | null
  receivedAt: string | null
  createdAt: string
  vendor: { id: string; name: string; email: string | null }
  user: { id: string; name: string }
  salesOrder: { id: string; soNumber: string } | null
  lineItems: POLineItem[]
  shipments: Shipment[]
}

const STATUS_OPTIONS = ["DRAFT", "PARTS_ORDERED", "RECEIVED", "ON_HOLD", "BACKORDERED", "CANCELLED"]

function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

export default function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [po, setPo] = useState<PODetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [changingStatus, setChangingStatus] = useState(false)

  function loadPO() {
    fetch(`/api/purchase-orders/${id}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setPo(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadPO()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleChangeStatus(newStatus: string) {
    setChangingStatus(true)
    await fetch(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    })
    setChangingStatus(false)
    toast.success(`Status updated to ${statusLabel(newStatus)}`)
    loadPO()
  }

  async function handleToggleReceived(lineItemId: string, received: boolean) {
    // Optimistic update
    setPo((prev) =>
      prev
        ? { ...prev, lineItems: prev.lineItems.map((li) => (li.id === lineItemId ? { ...li, received } : li)) }
        : prev
    )
    await fetch(`/api/purchase-orders/${id}/line-items/${lineItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received }),
    })
    loadPO()
  }

  async function handleUpdateSerial(lineItemId: string, serialNumber: string) {
    await fetch(`/api/purchase-orders/${id}/line-items/${lineItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serialNumber }),
    })
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>
  if (notFound || !po) return <p className="text-sm text-red-600">Purchase Order not found.</p>

  const total = po.lineItems.reduce((sum, li) => sum + li.unitCost * li.quantity, 0)
  const receivedCount = po.lineItems.filter((li) => li.received).length

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/purchase-orders" className="text-sm text-zinc-500 hover:underline inline-block mb-2">
          ← Back to Purchase Orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{po.poNumber}</h1>
            {po.salesOrder && (
              <p className="text-sm text-zinc-500">
                From{" "}
                <Link href={`/dashboard/sales-orders/${po.salesOrder.id}`} className="hover:underline font-medium">
                  {po.salesOrder.soNumber}
                </Link>
              </p>
            )}
          </div>
          <select
            value={po.status}
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Left: main content */}
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-md border p-4 space-y-1 text-sm">
            <p><span className="text-zinc-500">Vendor:</span> {po.vendor.name}</p>
            <p><span className="text-zinc-500">Owner:</span> {po.user.name}</p>
            <p><span className="text-zinc-500">Payment Terms:</span> {po.paymentType}</p>
            <p><span className="text-zinc-500">Created:</span> {new Date(po.createdAt).toLocaleDateString()}</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Line Items</h2>
              <span className="text-sm text-zinc-500">
                {receivedCount} / {po.lineItems.length} received
              </span>
            </div>

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-xs text-zinc-500">
                    <th className="py-2 pl-4 w-10">✓</th>
                    <th className="py-2">Part #</th>
                    <th className="py-2">Description</th>
                    <th className="py-2 w-16">Qty</th>
                    <th className="py-2 w-24">Unit Cost</th>
                    <th className="py-2 w-24">Total</th>
                    <th className="py-2 w-32 pr-4">Serial #</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lineItems.map((li) => (
                    <tr key={li.id} className="border-b last:border-0">
                      <td className="py-2 pl-4">
                        <input
                          type="checkbox"
                          checked={li.received}
                          onChange={(e) => handleToggleReceived(li.id, e.target.checked)}
                        />
                      </td>
                      <td className="py-2">{li.sku ?? "—"}</td>
                      <td className="py-2">{li.name}</td>
                      <td className="py-2">{li.quantity}</td>
                      <td className="py-2">{money(li.unitCost)}</td>
                      <td className="py-2 font-medium">{money(li.unitCost * li.quantity)}</td>
                      <td className="py-2 pr-4">
                        <input
                          type="text"
                          defaultValue={li.serialNumber ?? ""}
                          onBlur={(e) => handleUpdateSerial(li.id, e.target.value)}
                          placeholder="—"
                          className="w-28 rounded border px-2 py-1 text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="rounded-md border p-3 text-sm">
                <span className="text-zinc-500 mr-3">Total</span>
                <span className="font-semibold">{money(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Shipments + Notes */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-md border p-4 space-y-3">
            <h2 className="font-semibold text-sm">Shipments</h2>
            {po.shipments.length === 0 && (
              <p className="text-sm text-zinc-500">No shipments logged yet.</p>
            )}
            {po.shipments.map((s) => (
              <div key={s.id} className="rounded-md border p-3 text-sm space-y-0.5">
                <p className="font-medium">{s.carrier ?? "Unknown carrier"}</p>
                <p className="text-zinc-500">{s.trackingNumber ?? "No tracking number"}</p>
                {s.shippedAt && (
                  <p className="text-xs text-zinc-400">Shipped {new Date(s.shippedAt).toLocaleDateString()}</p>
                )}
                {s.notes && <p className="text-xs text-zinc-500">{s.notes}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-md border p-4 space-y-2">
            <h2 className="font-semibold text-sm">Notes</h2>
            <p className="text-sm text-zinc-500">{po.internalNotes || "No notes."}</p>
          </div>
        </div>
      </div>
    </div>
  )
}