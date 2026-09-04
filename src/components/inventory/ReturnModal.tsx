"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import type { LocationPathOption } from "@/lib/inventory/locationPaths"

export function ReturnModal({
  assetId,
  assetStatus,
  onClose,
  onDone,
}: {
  assetId: string
  assetStatus: string
  onClose: () => void
  onDone: () => void
}) {
  const [containers, setContainers] = useState<LocationPathOption[]>([])
  const [containerId, setContainerId] = useState("")
  const [reason, setReason] = useState<"REFUND" | "DISPOSAL" | "HOLDING_STOCK" | "">("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/inventory-locations/own-company").then((res) => res.json()).then((data) => Array.isArray(data) && setContainers(data))
  }, [])

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
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">Select a reason</option>
              <option value="REFUND">Refund</option>
              <option value="DISPOSAL">Disposal</option>
              <option value="HOLDING_STOCK">Holding Stock (still client-owned)</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Container</label>
          <select value={containerId} onChange={(e) => setContainerId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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