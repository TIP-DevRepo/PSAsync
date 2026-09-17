"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { buildLocationPathOptions, type LocationPathOption } from "@/lib/inventory/locationPaths"
import { plainStatusLabel } from "@/lib/inventory/statusLabel"
import { CatalogItemPicker, type CatalogItemOption } from "@/components/inventory/CatalogItemPicker"

interface ClientOption {
  id: string
  name: string
  isInternal: boolean
}
interface ClientLocationOption {
  id: string
  name: string
}

type ItemKind = "ASSET" | "STOCK"

const ASSET_STATUSES = ["IN_STOCK", "INTERNAL", "LOANED", "SOLD", "PENDING_OFFBOARD", "REMOVED"] as const

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function AddInventoryItemModal({
  initialClientId,
  onClose,
  onDone,
}: {
  initialClientId?: string
  onClose: () => void
  onDone: () => void
}) {
  const [kind, setKind] = useState<ItemKind>("ASSET")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientId, setClientId] = useState(initialClientId ?? "")

  const [clientInventoryOnboarded, setClientInventoryOnboarded] = useState(false)
  const [sites, setSites] = useState<ClientLocationOption[]>([])
  const [siteId, setSiteId] = useState("")

  const [containers, setContainers] = useState<LocationPathOption[]>([])
  const [containerId, setContainerId] = useState("")

  // Container is a hard schema requirement for Pooled Stock (InventoryStock
  // has no "just at the site" fallback), but for a Serialized Asset it's
  // only meaningful once the client has actually been onboarded for
  // Inventory AND the chosen site has containers built under it — otherwise
  // there's nothing sensible to pick from, so it stays optional and the
  // asset just tracks at the site level (mirrors PO receiving's own
  // client-owned-but-no-container fallback).
  const containerRequired = kind === "STOCK" || (clientInventoryOnboarded && containers.length > 0)

  const [catalogItem, setCatalogItem] = useState<CatalogItemOption | null>(null)
  const [serialNumber, setSerialNumber] = useState("")
  const [status, setStatus] = useState<string>("IN_STOCK")
  const [quantity, setQuantity] = useState("")

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data: ClientOption[]) => Array.isArray(data) && setClients(data))
  }, [])

  useEffect(() => {
    setSiteId("")
    setSites([])
    setContainerId("")
    setContainers([])
    setClientInventoryOnboarded(false)
    if (!clientId) return
    fetch(`/api/clients/${clientId}`)
      .then((res) => res.json())
      .then((client) => {
        setSites(client.locations ?? [])
        setClientInventoryOnboarded(!!client.inventoryOnboarded)
      })
  }, [clientId])

  useEffect(() => {
    setContainerId("")
    setContainers([])
    if (!siteId) return
    fetch(`/api/inventory-locations?clientLocationId=${siteId}`)
      .then((res) => res.json())
      .then((data) => setContainers(buildLocationPathOptions(data.locations ?? [])))
  }, [siteId])

  function handleKindChange(next: ItemKind) {
    setKind(next)
    setCatalogItem(null)
    setSerialNumber("")
    setQuantity("")
    setStatus("IN_STOCK")
    setError(null)
  }

  async function handleSubmit() {
    setError(null)

    if (!clientId) { setError("Select a client"); return }
    if (!catalogItem) { setError("Select a Catalog Item"); return }
    if (!siteId) { setError("Select a location"); return }
    if (kind === "STOCK" && !clientInventoryOnboarded) {
      setError("This client isn't onboarded for Inventory management yet — onboard it before adding Pooled Stock")
      return
    }
    if (containerRequired && !containerId) { setError("Select a container"); return }

    let body: Record<string, unknown>

    if (kind === "ASSET") {
      if (!serialNumber.trim()) { setError("Serial number is required"); return }
      body = {
        catalogItemId: catalogItem.id,
        clientId,
        clientLocationId: siteId,
        locationId: containerId || null,
        serialNumber: serialNumber.trim(),
        status,
      }
    } else {
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty <= 0) { setError("Enter a valid quantity"); return }
      body = {
        catalogItemId: catalogItem.id,
        clientLocationId: siteId,
        locationId: containerId,
        quantity: qty,
      }
    }

    setSaving(true)
    const res = await fetch(kind === "ASSET" ? "/api/inventory-assets" : "/api/inventory-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSaving(false)

    if (res.ok) {
      onDone()
      onClose()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't add this item")
    }
  }

  return (
    <Modal maxWidth="lg" scrollable onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Add Inventory Item</h2>

      <div className="mt-4 flex gap-2">
        {(["ASSET", "STOCK"] as ItemKind[]).map((k) => (
          <button
            key={k}
            onClick={() => handleKindChange(k)}
            className={`rounded-full px-3 py-1 text-sm border transition-colors ${
              kind === k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-surface-hover"
            }`}
          >
            {k === "ASSET" ? "Serialized Asset" : "Pooled Stock"}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Client / Ownership</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={SELECT_CLASS}>
            <option value="">Select a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.isInternal ? " (Internal)" : ""}</option>
            ))}
          </select>
        </div>

        <CatalogItemPicker isSerialized={kind === "ASSET"} value={catalogItem} onChange={setCatalogItem} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Location</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!clientId} className={`${SELECT_CLASS} disabled:opacity-50`}>
              <option value="">Select a location</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Container{containerRequired ? " *" : ""}</label>
            <select
              value={containerId}
              onChange={(e) => setContainerId(e.target.value)}
              disabled={!siteId || !clientInventoryOnboarded}
              className={`${SELECT_CLASS} disabled:opacity-50`}
            >
              <option value="">{containerRequired ? "Select a container" : "None (track at location level)"}</option>
              {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {siteId && !clientInventoryOnboarded && (
          <p className={`text-xs ${kind === "STOCK" ? "text-danger" : "text-muted-foreground"}`}>
            {kind === "STOCK"
              ? "This client isn't onboarded for Inventory management yet, so there's no container to place Pooled Stock in here. Onboard it for Inventory first."
              : "This client isn't onboarded for Inventory management yet, so Container selection is disabled — the asset will just be tracked at the location level."}
          </p>
        )}

        {siteId && clientInventoryOnboarded && containers.length === 0 && (
          <p className={`text-xs ${kind === "STOCK" ? "text-danger" : "text-muted-foreground"}`}>
            {kind === "STOCK"
              ? "This location has no containers set up yet. Pooled Stock always needs one — set one up under this client's Locations first."
              : "This location has no containers set up yet, so the asset will just be tracked at the location level."}
          </p>
        )}

        {kind === "ASSET" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Serial Number *</label>
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className={SELECT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT_CLASS}>
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>{plainStatusLabel(s)}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Quantity *</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={SELECT_CLASS}
            />
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? "Adding..." : kind === "ASSET" ? "Add Asset" : "Add Stock"}
        </Button>
      </div>
    </Modal>
  )
}
