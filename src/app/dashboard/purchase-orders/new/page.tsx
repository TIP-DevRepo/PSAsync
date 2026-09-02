"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface VendorOption {
  id: string
  name: string
}

interface SalesOrderOption {
  id: string
  soNumber: string
  clientName: string
}

interface ClientOption {
  id: string
  name: string
  isInternal: boolean
}

interface ClientLocationOption {
  id: string
  name: string
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  shippingContact: { firstName: string; lastName: string } | null
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrderOption[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Ship-to-client resolution: either pulled from a linked Sales Order's
  // shipping snapshot, or picked directly from a client's saved shipping
  // location if no Sales Order is linked.
  const [shipClientId, setShipClientId] = useState("")
  const [shipClientLocations, setShipClientLocations] = useState<ClientLocationOption[]>([])
  const [shipClientLocationId, setShipClientLocationId] = useState("")

  // Ship-to-own-company resolution: locations belonging to whichever
  // client is flagged isInternal.
  const [ownLocations, setOwnLocations] = useState<ClientLocationOption[]>([])
  const [ownLocationId, setOwnLocationId] = useState("")
  const [noInternalClient, setNoInternalClient] = useState(false)

  const [form, setForm] = useState({
    vendorId: "",
    salesOrderId: "",
    paymentType: "",
    internalNotes: "",
    shipToClient: true,
    shipContactName: "",
    shipAddress: "",
    shipAddress2: "",
    shipCity: "",
    shipState: "",
    shipZip: "",
    shipCountry: "",
  })

  useEffect(() => {
    fetch("/api/vendors")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setVendors(data))
    fetch("/api/sales-orders")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setSalesOrders(data.map((so: { id: string; soNumber: string; clientName: string }) => ({ id: so.id, soNumber: so.soNumber, clientName: so.clientName }))))
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data: ClientOption[]) => {
        if (!Array.isArray(data)) return
        setClients(data)
        const internal = data.find((c) => c.isInternal)
        if (!internal) {
          setNoInternalClient(true)
          return
        }
        fetch(`/api/clients/${internal.id}`)
          .then((res) => res.json())
          .then((full) => setOwnLocations(full.locations ?? []))
      })
  }, [])

  function update(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // When a Sales Order is linked, pull its ship-to snapshot straight in —
  // this is the "carried over from quote/SO" path from the spec.
  async function handleSalesOrderSelect(soId: string) {
    update("salesOrderId", soId)
    if (!soId) return

    const res = await fetch(`/api/sales-orders/${soId}`)
    const so = await res.json()

    setForm((prev) => ({
      ...prev,
      salesOrderId: soId,
      shipContactName: so.shipContactName ?? "",
      shipAddress: so.shipAddress ?? "",
      shipAddress2: so.shipAddress2 ?? "",
      shipCity: so.shipCity ?? "",
      shipState: so.shipState ?? "",
      shipZip: so.shipZip ?? "",
      shipCountry: so.shipCountry ?? "",
    }))
  }

  async function handleShipClientSelect(clientId: string) {
    setShipClientId(clientId)
    setShipClientLocationId("")
    setShipClientLocations([])
    if (!clientId) return

    const res = await fetch(`/api/clients/${clientId}`)
    const client = await res.json()
    setShipClientLocations(client.locations ?? [])
  }

  function applyShipClientLocation(locationId: string) {
    setShipClientLocationId(locationId)
    const loc = shipClientLocations.find((l) => l.id === locationId)
    if (!loc) return
    setForm((prev) => ({
      ...prev,
      shipContactName: loc.shippingContact ? `${loc.shippingContact.firstName} ${loc.shippingContact.lastName}` : "",
      shipAddress: loc.address ?? "",
      shipAddress2: loc.address2 ?? "",
      shipCity: loc.city ?? "",
      shipState: loc.state ?? "",
      shipZip: loc.zip ?? "",
      shipCountry: loc.country ?? "",
    }))
  }

  function applyOwnLocation(locationId: string) {
    setOwnLocationId(locationId)
    const loc = ownLocations.find((l) => l.id === locationId)
    if (!loc) return
    setForm((prev) => ({
      ...prev,
      shipContactName: loc.shippingContact ? `${loc.shippingContact.firstName} ${loc.shippingContact.lastName}` : "",
      shipAddress: loc.address ?? "",
      shipAddress2: loc.address2 ?? "",
      shipCity: loc.city ?? "",
      shipState: loc.state ?? "",
      shipZip: loc.zip ?? "",
      shipCountry: loc.country ?? "",
    }))
  }

  async function handleSave() {
    if (!form.vendorId) {
      setError("Please select a vendor.")
      return
    }

    setSaving(true)
    setError("")

    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        shipClientId: form.salesOrderId ? undefined : shipClientId,
        shipClientLocationId: form.salesOrderId ? undefined : shipClientLocationId,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Something went wrong creating this Purchase Order.")
      setSaving(false)
      return
    }

    const po = await res.json()
    router.push(`/dashboard/purchase-orders/${po.id}`)
  }

  return (
    <div className="w-full max-w-4xl space-y-6">
      <h1 className="text-display font-semibold tracking-tight text-foreground">New Purchase Order</h1>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
        <h2 className="font-semibold text-sm text-foreground">Vendor</h2>
        <select
          value={form.vendorId}
          onChange={(e) => update("vendorId", e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select a vendor...</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Link to Sales Order (optional)</label>
            <select
              value={form.salesOrderId}
              onChange={(e) => handleSalesOrderSelect(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {salesOrders.map((so) => (
                <option key={so.id} value={so.id}>{so.soNumber} — {so.clientName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Payment Type</label>
            <select
              value={form.paymentType}
              onChange={(e) => update("paymentType", e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Use company default</option>
              <option value="Due on Receipt">Due on Receipt</option>
              <option value="Net15">Net 15</option>
              <option value="Net30">Net 30</option>
              <option value="Net45">Net 45</option>
              <option value="Net60">Net 60</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Credit Card">Credit Card</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
        <h2 className="font-semibold text-sm text-foreground">Shipping</h2>
        <p className="text-xs text-muted-foreground">Are these items shipping to the client?</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              checked={form.shipToClient}
              onChange={() => update("shipToClient", true)}
              className="accent-primary"
            />
            Yes — ships to the client
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="radio"
              checked={!form.shipToClient}
              onChange={() => update("shipToClient", false)}
              className="accent-primary"
            />
            No — ships to us
          </label>
        </div>

        {form.shipToClient ? (
          <div className="space-y-3">
            {form.salesOrderId ? (
              <p className="text-xs text-muted-foreground">
                Shipping address pulled from the linked Sales Order — edit the fields below if needed.
              </p>
            ) : (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Client</label>
                <select
                  value={shipClientId}
                  onChange={(e) => handleShipClientSelect(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select a client...</option>
                  {clients.filter((c) => !c.isInternal).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {shipClientLocations.length > 0 && (
                  <select
                    value={shipClientLocationId}
                    onChange={(e) => applyShipClientLocation(e.target.value)}
                    className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">Select a location...</option>
                    {shipClientLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            {noInternalClient ? (
              <p className="text-xs text-warning">
                No client is currently marked as your own company. Go to a client's Details tab and check &quot;This is your own company&quot; to set one, then come back here.
              </p>
            ) : (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Ship to which of your locations?</label>
                <select
                  value={ownLocationId}
                  onChange={(e) => applyOwnLocation(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select a location...</option>
                  {ownLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 pt-2">
          <input
            type="text"
            placeholder="Contact Name"
            value={form.shipContactName}
            onChange={(e) => update("shipContactName", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Address"
            value={form.shipAddress}
            onChange={(e) => update("shipAddress", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Suite, Apt, Unit (optional)"
            value={form.shipAddress2}
            onChange={(e) => update("shipAddress2", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="City"
              value={form.shipCity}
              onChange={(e) => update("shipCity", e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="State"
              value={form.shipState}
              onChange={(e) => update("shipState", e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="Zip"
              value={form.shipZip}
              onChange={(e) => update("shipZip", e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <input
            type="text"
            placeholder="Country"
            value={form.shipCountry}
            onChange={(e) => update("shipCountry", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
        <h2 className="font-semibold text-sm text-foreground">Internal Notes</h2>
        <textarea
          value={form.internalNotes}
          onChange={(e) => update("internalNotes", e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push("/dashboard/purchase-orders")}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Creating..." : "Create Purchase Order"}
        </Button>
      </div>
    </div>
  )
}