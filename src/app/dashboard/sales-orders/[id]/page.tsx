"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/Modal"
import { toast } from "@/lib/toast"
import { TabsBar } from "@/components/ui/tabs-bar"
import { SOLineItemBuilder, type SOCatalogOption, type SOVendorOption, type SOLineItemBuilderItem } from "@/components/sales-orders/SOLineItemBuilder"
import { FileUploadZone } from "@/components/attachments/FileUploadZone"

// ─── Types ────────────────────────────────────────────────────────────────
interface SOLineItem {
  id: string
  name: string
  description: string | null
  partNumber: string | null
  sku: string | null
  vendorSku: string | null
  vendor: { id: string; name: string } | null
  section: string | null
    quantity: number
    unitPrice: number
    cost: number
    discount: number
    taxable: boolean
    isRecurring: boolean
    recurringInterval: "MONTHLY" | "QUARTERLY" | "ANNUALLY" | null
    isTextBlock: boolean
    bundleName: string | null
    bundleDisplayMode: string | null
    isBundleHeader: boolean
    sortOrder: number
    fulfillingPOLineItems: { id: string }[]
    catalogItemId: string | null
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
  paymentTerms: string | null
  internalNotes: string | null
  clientNotes: string | null
  billContactName: string | null
  billAddress: string | null
  billAddress2: string | null
  billCity: string | null
  billState: string | null
  billZip: string | null
  billCountry: string | null
  shipContactName: string | null
  shipAddress: string | null
  shipAddress2: string | null
  shipCity: string | null
  shipState: string | null
  shipZip: string | null
  shipCountry: string | null
  createdAt: string
  client: { id: string; name: string }
  user: { id: string; name: string }
  quote: { id: string; quoteNumber: string } | null
  lineItems: SOLineItem[]
  purchaseOrders: PurchaseOrderSummary[]
}

interface SOCommentType {
  id: string
  authorName: string
  message: string
  createdAt: string
}

interface SOAttachmentType {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  createdAt: string
}

type SOTabKey = "details" | "notes" | "attachments"

const SO_TABS: { key: SOTabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "notes", label: "Internal Notes" },
  { key: "attachments", label: "Attachments" },
]

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
  DRAFT: "bg-muted text-muted-foreground",
  PARTS_ORDERED: "bg-info-bg text-info",
  RECEIVED: "bg-success-bg text-success",
  ON_HOLD: "bg-warning-bg text-warning",
  BACKORDERED: "bg-warning-bg text-warning",
  CANCELLED: "bg-danger-bg text-danger",
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

function typeLabel(li: SOLineItem) {
  if (!li.isRecurring) return "One-time"
  if (!li.recurringInterval) return "Recurring"
  return `Recurring (${li.recurringInterval.charAt(0) + li.recurringInterval.slice(1).toLowerCase()})`
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const [activeTab, setActiveTab] = useState<SOTabKey>("details")

  const [comments, setComments] = useState<SOCommentType[]>([])
  const [newComment, setNewComment] = useState("")
  const [postingComment, setPostingComment] = useState(false)

  const [attachments, setAttachments] = useState<SOAttachmentType[]>([])

  const [catalog, setCatalog] = useState<SOCatalogOption[]>([])
  const [vendors, setVendors] = useState<SOVendorOption[]>([])

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

  function loadComments() {
    fetch(`/api/sales-orders/${id}/comments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setComments(data))
  }

  function loadAttachments() {
    fetch(`/api/sales-orders/${id}/attachments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setAttachments(data))
  }

  useEffect(() => {
    loadSO()
    loadComments()
    loadAttachments()
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setCatalog(data.filter((i: { active: boolean }) => i.active)))
    fetch("/api/vendors")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setVendors(data))
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

  async function handlePostComment() {
    if (!newComment.trim()) return
    setPostingComment(true)
    await fetch(`/api/sales-orders/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: newComment.trim() }),
    })
    setNewComment("")
    setPostingComment(false)
    loadComments()
  }

  async function handleDeleteAttachment(attachmentId: string) {
    await fetch(`/api/sales-orders/${id}/attachments/${attachmentId}`, { method: "DELETE" })
    toast.success("Attachment removed")
    loadAttachments()
  }

  async function createLineItem(payload: Record<string, unknown>) {
    await fetch(`/api/sales-orders/${id}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    loadSO()
  }

  async function updateLineItem(lineItemId: string, patch: Record<string, unknown>) {
    // Optimistic update — unlike Purchase Orders, no SO line item field
    // triggers a server-side side effect (no auto status advance), so
    // there's never a reason to wait on a full reload here. Matches the
    // Doherty Threshold rule: perceived speed matters more than a
    // "confirmed by the server" round trip for a reversible field edit.
    setSo((prev) =>
      prev
        ? { ...prev, lineItems: prev.lineItems.map((li) => (li.id === lineItemId ? { ...li, ...patch } : li)) }
        : prev
    )

    const res = await fetch(`/api/sales-orders/${id}/line-items/${lineItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })

    if (!res.ok) {
      toast.error("Couldn't save that change")
      loadSO()
    }
  }

  async function deleteLineItem(lineItemId: string) {
    await fetch(`/api/sales-orders/${id}/line-items/${lineItemId}`, { method: "DELETE" })
    loadSO()
  }

  async function duplicateLineItem(li: SOLineItemBuilderItem) {
    await fetch(`/api/sales-orders/${id}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogItemId: li.catalogItemId,
        vendorId: li.vendor?.id,
        name: li.name,
        description: li.description ?? undefined,
        partNumber: li.partNumber ?? undefined,
        sku: li.sku ?? undefined,
        vendorSku: li.vendorSku ?? undefined,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        cost: li.cost,
        discount: li.discount,
        taxable: li.taxable,
        isRecurring: li.isRecurring,
        recurringInterval: li.recurringInterval ?? undefined,
        bundleName: li.bundleName ?? undefined,
      }),
    })
    loadSO()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (notFound || !so) return <p className="text-sm text-danger">Sales Order not found.</p>

  const pricedItems = so.lineItems.filter((li) => !li.isTextBlock)
  const subtotal = pricedItems.reduce((sum, li) => sum + lineTotal(li), 0)

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
        <Link href="/dashboard/sales-orders" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-block mb-2">
          ← Back to Sales Orders
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-display font-semibold tracking-tight text-foreground">{so.soNumber}</h1>
            <p className="text-sm text-muted-foreground">
              {so.quote ? (
                <>
                  From Quote{" "}
                  <Link href={`/dashboard/quotes/${so.quote.id}`} className="hover:underline font-medium text-foreground">
                    {so.quote.quoteNumber}
                  </Link>
                </>
              ) : (
                "Created manually"
              )}
            </p>
          </div>
          <select
            value={so.status}
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

      <TabsBar tabs={SO_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Sales Order sections" />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "details" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: main content */}
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Client:</span> <span className="text-foreground">{so.client.name}</span></p>
                <p><span className="text-muted-foreground">Owner:</span> <span className="text-foreground">{so.user.name}</span></p>
                <p><span className="text-muted-foreground">Client PO #:</span> <span className="text-foreground">{so.clientPoNumber ?? "—"}</span></p>
                <p><span className="text-muted-foreground">Payment Terms:</span> <span className="text-foreground">{so.paymentTerms ?? "—"}</span></p>
                <p><span className="text-muted-foreground">Created:</span> <span className="text-foreground">{new Date(so.createdAt).toLocaleDateString()}</span></p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1 text-sm">
                  <h2 className="font-semibold text-sm mb-1 text-foreground">Bill To</h2>
                  <p className="text-foreground">{so.billContactName ?? "—"}</p>
                  <p className="text-muted-foreground">{so.billAddress ?? "—"}</p>
                  {so.billAddress2 && <p className="text-muted-foreground">{so.billAddress2}</p>}
                  <p className="text-muted-foreground">{[so.billCity, so.billState, so.billZip].filter(Boolean).join(", ")}</p>
                </div>
                <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-1 text-sm">
                  <h2 className="font-semibold text-sm mb-1 text-foreground">Ship To</h2>
                  <p className="text-foreground">{so.shipContactName ?? "—"}</p>
                  <p className="text-muted-foreground">{so.shipAddress ?? "—"}</p>
                  {so.shipAddress2 && <p className="text-muted-foreground">{so.shipAddress2}</p>}
                  <p className="text-muted-foreground">{[so.shipCity, so.shipState, so.shipZip].filter(Boolean).join(", ")}</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-heading text-foreground">Line Items</h2>
                  <Button size="sm" onClick={() => setShowGeneratePO(true)}>
                    + Generate Purchase Order
                  </Button>
                </div>

                <SOLineItemBuilder
                  items={so.lineItems.map((li) => ({
                    id: li.id,
                    catalogItemId: li.catalogItemId,
                    vendorId: li.vendor?.id ?? null,
                    vendor: li.vendor,
                    partNumber: li.partNumber,
                    sku: li.sku,
                    vendorSku: li.vendorSku,
                    name: li.name,
                    description: li.description,
                    quantity: li.quantity,
                    unitPrice: li.unitPrice,
                    cost: li.cost,
                    discount: li.discount,
                    taxable: li.taxable,
                    isRecurring: li.isRecurring,
                    recurringInterval: li.recurringInterval,
                    bundleName: li.bundleName,
                    bundleDisplayMode: li.bundleDisplayMode,
                    isBundleHeader: li.isBundleHeader,
                    sortOrder: li.sortOrder,
                  }))}
                  catalog={catalog}
                  vendors={vendors}
                  locked={so.status !== "DRAFT"}
                  onCreate={createLineItem}
                  onUpdate={updateLineItem}
                  onDelete={deleteLineItem}
                  onDuplicate={duplicateLineItem}
                />

                <div className="flex justify-end">
                  <div className="rounded-lg border border-border bg-card shadow-card p-3 text-sm">
                    <span className="text-muted-foreground mr-3">Subtotal</span>
                    <span className="font-semibold text-foreground tabular-nums">{money(subtotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Purchase Orders */}
            <div className="space-y-3">
              <h2 className="font-semibold text-sm text-foreground">Purchase Orders</h2>
              {so.purchaseOrders.length === 0 && (
                <p className="text-sm text-muted-foreground">No Purchase Orders generated yet.</p>
              )}
              {so.purchaseOrders.map((po) => (
                <div key={po.id} className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
                  <Link
                    href={`/dashboard/purchase-orders/${po.id}`}
                    className="flex items-center justify-between p-3 text-sm hover:bg-surface-hover border-b border-border transition-colors"
                  >
                    <span>
                      <span className="font-medium text-foreground">{po.poNumber}</span>
                      <span className="text-muted-foreground block text-xs">{po.vendor.name}</span>
                    </span>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${PO_STATUS_COLORS[po.status]}`}>
                      {statusLabel(po.status)}
                    </span>
                  </Link>
                  <div className="divide-y divide-border">
                    {po.lineItems.map((li) => (
                      <div key={li.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <span className="flex items-center gap-2 text-foreground">
                          {li.received ? (
                            <span className="text-success">✓</span>
                          ) : (
                            <span className="text-muted-foreground">○</span>
                          )}
                          {li.name} {li.sku && <span className="text-muted-foreground">({li.sku})</span>}
                        </span>
                        <span className="text-muted-foreground">Qty {li.quantity}</span>
                      </div>
                    ))}
                  </div>
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
              uploadUrl={`/api/sales-orders/${id}/attachments`}
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
        salesOrderId,
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
      <h2 className="text-lg font-bold text-foreground">Generate Purchase Order</h2>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1 text-foreground">Vendor *</label>
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select a vendor...</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-foreground">Line Items to Order</label>
          <button onClick={toggleAll} className="text-xs text-muted-foreground hover:underline">
            {selected.size === orderableItems.length ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto rounded-md border border-border p-2">
          {orderableItems.map((li) => (
            <label
              key={li.id}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                checked={selected.has(li.id)}
                onChange={() => toggleItem(li.id)}
              />
              <span className="flex-1 text-foreground">
                {li.bundleName && (
                  <span className="text-xs text-primary block">📦 in {li.bundleName}</span>
                )}
                {li.name} {li.sku && <span className="text-muted-foreground">({li.sku})</span>}
              </span>
              <span className="text-muted-foreground">Qty {li.quantity}</span>
            </label>
          ))}
          {orderableItems.length === 0 && (
            <p className="text-sm text-muted-foreground px-2 py-2">No orderable items on this Sales Order.</p>
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