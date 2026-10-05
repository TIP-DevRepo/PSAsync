"use client"

import { useState, useEffect } from "react"

export interface ClientLocationAddress {
  contactName: string
  address: string
  address2: string
  city: string
  state: string
  zip: string
  country: string
}

interface ClientLocationRecord {
  id: string
  name: string
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  billingContact: { firstName: string; lastName: string } | null
  shippingContact: { firstName: string; lastName: string } | null
}

function addressFromLocation(loc: ClientLocationRecord, contactType: "billing" | "shipping"): ClientLocationAddress {
  const contact = contactType === "billing" ? loc.billingContact : loc.shippingContact
  return {
    contactName: contact ? `${contact.firstName} ${contact.lastName}` : "",
    address: loc.address ?? "",
    address2: loc.address2 ?? "",
    city: loc.city ?? "",
    state: loc.state ?? "",
    zip: loc.zip ?? "",
    country: loc.country ?? "",
  }
}

interface ClientLocationPickerProps {
  clientId: string
  contactType: "billing" | "shipping"
  value: string
  onSelect: (locationId: string, address: ClientLocationAddress | null) => void
  placeholder?: string
  className?: string
}

const DEFAULT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

// Lets the user pick one of a client's saved locations and applies its
// address as a snapshot into the calling form, same pattern Purchase
// Orders and Sales Orders both use. A location is never stored as a live
// link here, picking one just copies its address fields in once.
export function ClientLocationPicker({
  clientId,
  contactType,
  value,
  onSelect,
  placeholder,
  className,
}: ClientLocationPickerProps) {
  const [fetchedForId, setFetchedForId] = useState<string | null>(null)
  const [locations, setLocations] = useState<ClientLocationRecord[]>([])

  useEffect(() => {
    if (!clientId) return
    fetch(`/api/clients/${clientId}`)
      .then((res) => res.json())
      .then((client) => {
        setLocations(client.locations ?? [])
        setFetchedForId(clientId)
      })
  }, [clientId])

  // Locations only apply to whichever client they were last fetched for —
  // once clientId changes (or clears), stop showing the previous client's
  // list until the new fetch above resolves, rather than clearing state
  // synchronously inside the effect itself.
  const currentLocations = fetchedForId === clientId ? locations : []

  function handleChange(locationId: string) {
    const loc = currentLocations.find((l) => l.id === locationId)
    onSelect(locationId, loc ? addressFromLocation(loc, contactType) : null)
  }

  if (!clientId || currentLocations.length === 0) return null

  return (
    <select value={value} onChange={(e) => handleChange(e.target.value)} className={className ?? DEFAULT_CLASS}>
      <option value="">{placeholder ?? "Select a location..."}</option>
      {currentLocations.map((loc) => (
        <option key={loc.id} value={loc.id}>{loc.name}</option>
      ))}
    </select>
  )
}
