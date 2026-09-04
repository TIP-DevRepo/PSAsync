"use client"

import { useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"

const REASONS = [
  { value: "BROKEN_SCRAPPED", label: "Broken / Scrapped" },
  { value: "LOST", label: "Lost" },
  { value: "DONATED", label: "Donated" },
  { value: "RETURNED_TO_VENDOR", label: "Returned to Vendor" },
  { value: "OTHER", label: "Other" },
]

export function RemoveAssetModal({
  assetId,
  onClose,
  onDone,
}: {
  assetId: string
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    if (!reason) { setError("Select a reason"); return }
    setSaving(true)
    const res = await fetch(`/api/inventory-assets/${assetId}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    })
    setSaving(false)
    if (res.ok) {
      onDone()
      onClose()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't remove asset")
    }
  }

  return (
    <Modal maxWidth="sm" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Remove Asset</h2>
      <div className="mt-4">
        <label className="block text-xs text-muted-foreground mb-1">Reason</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="">Select a reason</option>
          {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving} variant="destructive">{saving ? "Removing..." : "Remove"}</Button>
      </div>
    </Modal>
  )
}