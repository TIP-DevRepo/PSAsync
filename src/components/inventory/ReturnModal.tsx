"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { buildLocationPathOptions, type LocationPathOption } from "@/lib/inventory/locationPaths"

interface ClientOption { id: string; name: string; inventoryOnboarded: boolean }
interface ClientLocationOption { id: string; name: string }
interface ClientListRow { id: string; isInternal: boolean }

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function ReturnModal({
  assetId,
  assetStatus,
  client,
  onClose,
  onDone,
}: {
  assetId: string
  assetStatus: string
  // The owning client (Sold) or loaned-to client (Loaned) — when they're
  // inventory-onboarded, the destination can be one of their own sites
  // instead of only ours.
  client?: ClientOption | null
  onClose: () => void
  onDone: () => void
}) {
  const canReturnToClient = !!client?.inventoryOnboarded

  // "Us" is just another client — the one flagged isInternal — so it
  // goes through the exact same Location -> Container lookup as any
  // other client rather than a separate flattened endpoint.
  const [ownCompanyId, setOwnCompanyId] = useState<string | null>(null)
  const [returnTo, setReturnTo] = useState<"us" | "client">("us")
  const [locations, setLocations] = useState<ClientLocationOption[]>([])
  const [locationId, setLocationId] = useState("")
  const [containers, setContainers] = useState<LocationPathOption[]>([])
  const [containerId, setContainerId] = useState("")
  const [reason, setReason] = useState<"REFUND" | "DISPOSAL" | "HOLDING_STOCK" | "">("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data: ClientListRow[]) => {
        const own = Array.isArray(data) ? data.find((c) => c.isInternal) : undefined
        if (own) setOwnCompanyId(own.id)
      })
  }, [])

  const selectedCompanyId = returnTo === "us" ? ownCompanyId : client?.id ?? null

  useEffect(() => {
    setLocationId("")
    setLocations([])
    if (!selectedCompanyId) return
    fetch(`/api/clients/${selectedCompanyId}`)
      .then((res) => res.json())
      .then((c) => setLocations(c.locations ?? []))
  }, [selectedCompanyId])

  useEffect(() => {
    setContainerId("")
    setContainers([])
    if (!locationId) return
    fetch(`/api/inventory-locations?clientLocationId=${locationId}`)
      .then((res) => res.json())
      .then((data) => setContainers(buildLocationPathOptions(data.locations ?? [])))
  }, [locationId])

  const needsReason = assetStatus === "SOLD"

  async function handleSubmit() {
    setError(null)
    if (!containerId) { setError("Select a container to return this to"); return }
    if (needsReason && !reason) { setError("Select a reason"); return }

    setSaving(true)
    const res = await fetch(`/api/inventory-assets/${assetId}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ containerId, ...(needsReason ? { reason } : {}) }),
    })
    setSaving(false)

    if (res.ok) {
      onDone()
      onClose()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't complete return")
    }
  }

  return (
    <Modal maxWidth="sm" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Return to Stock</h2>

      <div className="mt-4 space-y-3">
        {needsReason && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={SELECT_CLASS}>
              <option value="">Select a reason</option>
              <option value="REFUND">Refund</option>
              <option value="DISPOSAL">Disposal</option>
              <option value="HOLDING_STOCK">Holding Stock (still client-owned)</option>
            </select>
          </div>
        )}

        {canReturnToClient && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Return To</label>
            <select
              value={returnTo}
              onChange={(e) => setReturnTo(e.target.value as "us" | "client")}
              className={SELECT_CLASS}
            >
              <option value="us">Us</option>
              <option value="client">{client!.name}</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Location</label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            disabled={!selectedCompanyId}
            className={`${SELECT_CLASS} disabled:opacity-50`}
          >
            <option value="">Select a location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Container</label>
          <select
            value={containerId}
            onChange={(e) => setContainerId(e.target.value)}
            disabled={!locationId}
            className={`${SELECT_CLASS} disabled:opacity-50`}
          >
            <option value="">Select a container</option>
            {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        {needsReason && (reason === "REFUND" || reason === "DISPOSAL") && (
          <p className="text-xs text-muted-foreground">This will be marked Pending Offboard until finalized.</p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>{saving ? "Returning..." : "Return"}</Button>
      </div>
    </Modal>
  )
}
