"use client"

import { useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import type { LocationPathOption } from "@/lib/inventory/locationPaths"

export interface ReceivableLineItem {
  id: string
  name: string
  quantity: number
  isSerialized: boolean
}

export interface ReceivePayload {
  serialNumbers?: string[]
  locationId?: string
  clientLocationId?: string
}

export function ReceiveModal({
  lineItems,
  shipToClient,
  receivingClientLocationId,
  receivingClientLocationName,
  companyLocationOptions,
  clientLocationOptions,
  onSubmit,
  onClose,
}: {
  lineItems: ReceivableLineItem[]
  shipToClient: boolean
  receivingClientLocationId: string | null
  receivingClientLocationName: string | null
  companyLocationOptions: LocationPathOption[]
  clientLocationOptions: LocationPathOption[]
  onSubmit: (receipts: { lineItemId: string; payload: ReceivePayload }[]) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}) {
  const [serialsByLineItem, setSerialsByLineItem] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    lineItems.forEach((li) => {
      if (li.isSerialized) initial[li.id] = Array(Math.round(li.quantity)).fill("")
    })
    return initial
  })
  const [pickedLocationId, setPickedLocationId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsLocationPick = shipToClient ? !receivingClientLocationId : true

  function updateSerial(lineItemId: string, index: number, value: string) {
    setSerialsByLineItem((prev) => {
      const next = [...(prev[lineItemId] ?? [])]
      next[index] = value
      return { ...prev, [lineItemId]: next }
    })
  }

  async function handleSubmit() {
    setError(null)

    if (needsLocationPick && !pickedLocationId) {
      setError(shipToClient ? "Select which client location this is shipping to" : "Select a warehouse location")
      return
    }
    for (const li of lineItems) {
      if (li.isSerialized && (serialsByLineItem[li.id] ?? []).some((s) => !s.trim())) {
        setError(`Every serial number is required for "${li.name}"`)
        return
      }
    }

    setSubmitting(true)
    const receipts = lineItems.map((li) => {
      const payload: ReceivePayload = {}
      if (li.isSerialized) payload.serialNumbers = serialsByLineItem[li.id].map((s) => s.trim())
      if (needsLocationPick) {
        if (shipToClient) payload.clientLocationId = pickedLocationId
        else payload.locationId = pickedLocationId
      }
      return { lineItemId: li.id, payload }
    })

    const result = await onSubmit(receipts)
    setSubmitting(false)

    if (result.ok) {
      onClose()
    } else {
      setError(result.error ?? "Couldn't complete receiving")
    }
  }

  return (
    <Modal maxWidth="lg" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">
        {lineItems.length === 1 ? `Receiving: ${lineItems[0].name}` : `Receiving ${lineItems.length} Line Items`}
      </h2>

      <div className="mt-4 space-y-4 max-h-96 overflow-y-auto pr-1">
        {lineItems.map((li) => (
          <div key={li.id} className="space-y-2">
            {lineItems.length > 1 && <p className="text-sm font-medium text-foreground">{li.name}</p>}
            {li.isSerialized ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Enter a serial number for each unit ({serialsByLineItem[li.id]?.length ?? 0}):
                </p>
                {(serialsByLineItem[li.id] ?? []).map((val, i) => (
                  <input
                    key={i}
                    type="text"
                    value={val}
                    onChange={(e) => updateSerial(li.id, i, e.target.value)}
                    placeholder={`Serial #${i + 1}`}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Non-serialized, quantity {li.quantity} will be added to stock.</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4">
        {needsLocationPick ? (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {shipToClient ? "Client Location" : "Warehouse Location"}
            </label>
            <select
              value={pickedLocationId}
              onChange={(e) => setPickedLocationId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select a location</option>
              {(shipToClient ? clientLocationOptions : companyLocationOptions).map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Shipping to: <span className="text-foreground">{receivingClientLocationName}</span>
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Receiving..." : "Confirm Receipt"}
        </Button>
      </div>
    </Modal>
  )
}