"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { TabsBar } from "@/components/ui/tabs-bar"
import { POLineItemBuilder, type POLineItemBuilderItem, type POCatalogOption } from "@/components/purchase-orders/POLineItemBuilder"
import type { ReceivePayload } from "@/components/purchase-orders/ReceiveModal"
import { FileUploadZone } from "@/components/attachments/FileUploadZone"
import { buildLocationPathOptions, type LocationPathOption } from "@/lib/inventory/locationPaths"

// ─── Types ────────────────────────────────────────────────────────────────
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
  shipToClient: boolean
  shipContactName: string | null
  shipAddress: string | null
  shipAddress2: string | null
  shipCity: string | null
  shipState: string | null
  shipZip: string | null
  shipCountry: string | null
  createdAt: string
  vendor: { id: string; name: string; email: string | null }
  user: { id: string; name: string }
  salesOrder: { id: string; soNumber: string; clientId: string } | null
  receivingClientLocation: { id: string; name: string } | null
  lineItems: (POLineItemBuilderItem & { sku: string | null })[]
  shipments: Shipment[]
}

interface POCommentType {
  id: string
  authorName: string
  message: string
  createdAt: string
}

interface POAttachmentType {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  createdAt: string
}

type POTabKey = "details" | "notes" | "attachments"

const PO_TABS: { key: POTabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "notes", label: "Internal Notes" },
  { key: "attachments", label: "Attachments" },
]

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

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const [activeTab, setActiveTab] = useState<POTabKey>("details")

  const [comments, setComments] = useState<POCommentType[]>([])
  const [newComment, setNewComment] = useState("")
  const [postingComment, setPostingComment] = useState(false)

  const [attachments, setAttachments] = useState<POAttachmentType[]>([])

  const [catalog, setCatalog] = useState<POCatalogOption[]>([])
  const [companyLocationOptions, setCompanyLocationOptions] = useState<LocationPathOption[]>([])
  const [clientLocationOptions, setClientLocationOptions] = useState<LocationPathOption[]>([])

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

  function loadComments() {
    fetch(`/api/purchase-orders/${id}/comments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setComments(data))
  }

  function loadAttachments() {
    fetch(`/api/purchase-orders/${id}/attachments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setAttachments(data))
  }

  useEffect(() => {
    loadPO()
    loadComments()
    loadAttachments()
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setCatalog(data.filter((i: { active: boolean }) => i.active)))
    fetch("/api/inventory-locations")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setCompanyLocationOptions(buildLocationPathOptions(data)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Client locations are only relevant for ship-to-client POs, and only
  // once we know which client — pulled from the linked Sales Order.
  useEffect(() => {
    if (!po?.shipToClient || !po.salesOrder?.clientId) {
      setClientLocationOptions([])
      return
    }
    fetch(`/api/clients/${po.salesOrder.clientId}`)
      .then((res) => res.json())
      .then((client) => {
        if (Array.isArray(client.locations)) {
          setClientLocationOptions(buildLocationPathOptions(client.locations))
        }
      })
  }, [po?.shipToClient, po?.salesOrder?.clientId])

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

  async function handlePostComment() {
    if (!newComment.trim()) return
    setPostingComment(true)
    await fetch(`/api/purchase-orders/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: newComment.trim() }),
    })
    setNewComment("")
    setPostingComment(false)
    loadComments()
  }

  async function handleDeleteAttachment(attachmentId: string) {
    await fetch(`/api/purchase-orders/${id}/attachments/${attachmentId}`, { method: "DELETE" })
    toast.success("Attachment removed")
    loadAttachments()
  }

  async function createLineItem(payload: Record<string, unknown>) {
    await fetch(`/api/purchase-orders/${id}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    loadPO()
  }

  async function updateLineItem(lineItemId: string, patch: Record<string, unknown>) {
    // Optimistic update applies immediately for every field.
    setPo((prev) =>
      prev
        ? { ...prev, lineItems: prev.lineItems.map((li) => (li.id === lineItemId ? { ...li, ...patch } : li)) }
        : prev
    )

    const res = await fetch(`/api/purchase-orders/${id}/line-items/${lineItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })

    if (!res.ok) {
      toast.error("Couldn't save that change")
      loadPO()
      return
    }

    // Only "received" has a real server-side side effect (auto-advancing
    // the PO's own status once every item is checked) — that's the only
    // case where a full reload is actually needed. Reloading after every
    // field edit was what caused the race: blurring an unrelated field
    // (e.g. Serial #) right before checking "received" fired its own
    // reload, which could land AFTER the received reload and stomp the
    // checkbox back to its old value.
    if ("received" in patch) {
      loadPO()
    }
  }

  async function handleReceiveMany(
    receipts: { lineItemId: string; payload: ReceivePayload }[]
  ): Promise<{ ok: boolean; error?: string }> {
    // Sequential on purpose — each call may generate Asset Tags off a
    // shared per-client counter, so they need to resolve one at a time
    // rather than racing each other.
    for (const { lineItemId, payload } of receipts) {
      const res = await fetch(`/api/purchase-orders/${id}/line-items/${lineItemId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        loadPO()
        return { ok: false, error: data.error ?? "Couldn't complete receiving" }
      }
    }

    toast.success(receipts.length === 1 ? "Line item received" : `${receipts.length} line items received`)
    loadPO()
    return { ok: true }
  }

  async function deleteLineItem(lineItemId: string) {
    await fetch(`/api/purchase-orders/${id}/line-items/${lineItemId}`, { method: "DELETE" })
    loadPO()
  }

  async function duplicateLineItem(li: POLineItemBuilderItem) {
    await fetch(`/api/purchase-orders/${id}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogItemId: li.catalogItemId,
        name: li.name,
        description: li.description ?? undefined,
        partNumber: li.partNumber ?? undefined,
        sku: li.sku ?? undefined,
        vendorSku: li.vendorSku ?? undefined,
        quantity: li.quantity,
        unitCost: li.unitCost,
      }),
    })
    loadPO()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (notFound || !po) return <p className="text-sm text-danger">Purchase Order not found.</p>

  const total = po.lineItems.reduce((sum, li) => sum + li.unitCost * li.quantity, 0)
  const receivedCount = po.lineItems.filter((li) => li.received).length

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/purchase-orders" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-block mb-2">
          ← Back to Purchase Orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-display font-semibold tracking-tight text-foreground">{po.poNumber}</h1>
            {po.salesOrder && (
              <p className="text-sm text-muted-foreground">
                From{" "}
                <Link href={`/dashboard/sales-orders/${po.salesOrder.id}`} className="hover:underline font-medium text-foreground">
                  {po.salesOrder.soNumber}
                </Link>
              </p>
            )}
          </div>
          <select
            value={po.status}
            onChange={(e) => handleChangeStatus(e.target.value)}
            disabled={changingStatus}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
      </div>

      <TabsBar tabs={PO_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Purchase Order sections" />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "details" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: main content */}
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Vendor:</span> <span className="text-foreground">{po.vendor.name}</span></p>
                <p><span className="text-muted-foreground">Owner:</span> <span className="text-foreground">{po.user.name}</span></p>
                <p><span className="text-muted-foreground">Payment Terms:</span> <span className="text-foreground">{po.paymentType}</span></p>
                <p><span className="text-muted-foreground">Created:</span> <span className="text-foreground">{new Date(po.createdAt).toLocaleDateString()}</span></p>
              </div>

              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1 text-sm">
                <h2 className="font-semibold text-sm mb-1 text-foreground">
                  Ship To {po.shipToClient ? "(Client)" : "(Us)"}
                </h2>
                <p className="text-foreground">{po.shipContactName ?? "—"}</p>
                <p className="text-muted-foreground">{po.shipAddress ?? "—"}</p>
                {po.shipAddress2 && <p className="text-muted-foreground">{po.shipAddress2}</p>}
                <p className="text-muted-foreground">{[po.shipCity, po.shipState, po.shipZip].filter(Boolean).join(", ")}</p>
                {po.shipToClient && po.receivingClientLocation && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Inventory location for received items: <span className="text-foreground">{po.receivingClientLocation.name}</span>
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-heading text-foreground">Line Items</h2>
                  <span className="text-sm text-muted-foreground">
                    {receivedCount} / {po.lineItems.length} received
                  </span>
                </div>

                <POLineItemBuilder
                  items={po.lineItems}
                  catalog={catalog}
                  locked={po.status === "CANCELLED" || po.status === "RECEIVED"}
                  shipToClient={po.shipToClient}
                  receivingClientLocationId={po.receivingClientLocation?.id ?? null}
                  receivingClientLocationName={po.receivingClientLocation?.name ?? null}
                  companyLocationOptions={companyLocationOptions}
                  clientLocationOptions={clientLocationOptions}
                  onCreate={createLineItem}
                  onUpdate={updateLineItem}
                  onDelete={deleteLineItem}
                  onDuplicate={duplicateLineItem}
                  onReceiveMany={handleReceiveMany}
                />

                <div className="flex justify-end">
                  <div className="rounded-lg border border-border bg-card shadow-card p-3 text-sm">
                    <span className="text-muted-foreground mr-3">Total</span>
                    <span className="font-semibold text-foreground tabular-nums">{money(total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Shipments */}
            <div className="space-y-3">
              <h2 className="font-semibold text-sm text-foreground">Shipments</h2>
              {po.shipments.length === 0 && (
                <p className="text-sm text-muted-foreground">No shipments logged yet.</p>
              )}
              {po.shipments.map((s) => (
                <div key={s.id} className="rounded-lg border border-border bg-card shadow-card p-3 text-sm space-y-0.5">
                  <p className="font-medium text-foreground">{s.carrier ?? "Unknown carrier"}</p>
                  <p className="text-muted-foreground">{s.trackingNumber ?? "No tracking number"}</p>
                  {s.shippedAt && (
                    <p className="text-xs text-muted-foreground">Shipped {new Date(s.shippedAt).toLocaleDateString()}</p>
                  )}
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "notes" && (
          <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold text-sm text-foreground">Internal Notes</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {comments.length === 0 && (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
              {comments.map((c) => (
                <div key={c.id} className="rounded-md bg-muted p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {c.authorName} · {new Date(c.createdAt).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap text-foreground">{c.message}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add an internal note..."
                rows={2}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button onClick={handlePostComment} disabled={postingComment || !newComment.trim()}>
                {postingComment ? "Posting..." : "Post"}
              </Button>
            </div>
          </div>
        )}

        {activeTab === "attachments" && (
          <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold text-sm text-foreground">Attachments</h2>
            <FileUploadZone
              uploadUrl={`/api/purchase-orders/${id}/attachments`}
              onUploaded={loadAttachments}
            />
            <div className="space-y-2">
              {attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">No files attached yet.</p>
              )}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {a.fileName}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{fileSizeLabel(a.fileSize)}</span>
                    <button
                      onClick={() => handleDeleteAttachment(a.id)}
                      className="text-xs text-danger hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}