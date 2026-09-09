"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { buildLocationPathOptions, type LocationPathOption } from "@/lib/inventory/locationPaths"

interface ClientListRow { id: string; isInternal: boolean }
interface ClientLocationOption { id: string; name: string }

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function OffboardModal({
  assetId,
  onClose,
  onDone,
}: {
  assetId: string
  onClose: () => void
  onDone: () => void
}) {
  // Offboarding always lands the asset back in our own stock, so
  // "our warehouse" is sourced the same way as any other client (the
  // one flagged isInternal), then its Location -> Container tree.
  const [ownCompanyId, setOwnCompanyId] = useState<string | null>(null)
  const [locations, setLocations] = useState<ClientLocationOption[]>([])
  const [locationId, setLocationId] = useState("")
  const [containers, setContainers] = useState<LocationPathOption[]>([])
  const [containerId, setContainerId] = useState("")
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

  useEffect(() => {
    setLocationId("")
    setLocations([])
    if (!ownCompanyId) return
    fetch(`/api/clients/${ownCompanyId}`)
      .then((res) => res.json())
      .then((c) => setLocations(c.locations ?? []))
  }, [ownCompanyId])

  useEffect(() => {
    setContainerId("")
    setContainers([])
    if (!locationId) return
    fetch(`/api/inventory-locations?clientLocationId=${locationId}`)
      .then((res) => res.json())
      .then((data) => setContainers(buildLocationPathOptions(data.locations ?? [])))
  }, [locationId])

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

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Location (optional)</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!ownCompanyId} className={`${SELECT_CLASS} disabled:opacity-50`}>
            <option value="">Keep current location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Container (optional)</label>
          <select value={containerId} onChange={(e) => setContainerId(e.target.value)} disabled={!locationId} className={`${SELECT_CLASS} disabled:opacity-50`}>
            <option value="">Keep current container</option>
            {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>{saving ? "Finishing..." : "Mark Offboarded"}</Button>
      </div>
    </Modal>
  )
}
