"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import type { LocationPathOption } from "@/lib/inventory/locationPaths"

export function OffboardModal({
  assetId,
  onClose,
  onDone,
}: {
  assetId: string
  onClose: () => void
  onDone: () => void
}) {
  const [containers, setContainers] = useState<LocationPathOption[]>([])
  const [containerId, setContainerId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/inventory-locations/own-company").then((res) => res.json()).then((data) => Array.isArray(data) && setContainers(data))
  }, [])

  async function handleSubmit() {
    setError(null)
    setSaving(true)
    const res = await fetch(`/api/inventory-assets/${assetId}/offboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerId ? { containerId } : {}),
    })
    setSaving(false)
    if (res.ok) {
      onDone()
      onClose()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't complete offboard")
    }
  }

  return (
    <Modal maxWidth="sm" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Finish Offboarding</h2>
      <p className="mt-2 text-sm text-muted-foreground">Optionally move this to a different container before finalizing.</p>

      <div className="mt-4">
        <label className="block text-xs text-muted-foreground mb-1">Container (optional)</label>
        <select value={containerId} onChange={(e) => setContainerId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">Keep current location</option>
          {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>{saving ? "Finishing..." : "Mark Offboarded"}</Button>
      </div>
    </Modal>
  )
}