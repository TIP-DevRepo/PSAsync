"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface ClientOption {
  id: string
  name: string
}

interface ClientLocation {
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

interface ClientFull {
  id: string
  paymentTerms: string | null
  mainBillingLocation: ClientLocation | null
  mainShippingLocation: ClientLocation | null
}

export default function NewSalesOrderPage() {
  const router = useRouter()
  const [clients, setClients] = useState<ClientOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    clientId: "",
    clientPoNumber: "",
    paymentTerms: "",
    internalNotes: "",
    billContactName: "",
    billAddress: "",
    billAddress2: "",
    billCity: "",
    billState: "",
    billZip: "",
    billCountry: "",
    shipContactName: "",
    shipAddress: "",
    shipAddress2: "",
    shipCity: "",
    shipState: "",
    shipZip: "",
    shipCountry: "",
  })

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setClients(data))
  }, [])

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // When a client is chosen, pull their default billing/shipping locations
  // and payment terms in as a starting point — everything stays editable
  // from here on and is stored as a snapshot on the SO, not a live link.
  async function handleClientSelect(clientId: string) {
    update("clientId", clientId)
    if (!clientId) return

    const res = await fetch(`/api/clients/${clientId}`)
    const client: ClientFull = await res.json()

    const bill = client.mainBillingLocation
    const ship = client.mainShippingLocation

    setForm((prev) => ({
      ...prev,
      clientId,
      paymentTerms: client.paymentTerms ?? "",
      billContactName: bill?.billingContact
        ? `${bill.billingContact.firstName} ${bill.billingContact.lastName}`
        : "",
      billAddress: bill?.address ?? "",
      billAddress2: bill?.address2 ?? "",
      billCity: bill?.city ?? "",
      billState: bill?.state ?? "",
      billZip: bill?.zip ?? "",
      billCountry: bill?.country ?? "",
      shipContactName: ship?.shippingContact
        ? `${ship.shippingContact.firstName} ${ship.shippingContact.lastName}`
        : "",
      shipAddress: ship?.address ?? "",
      shipAddress2: ship?.address2 ?? "",
      shipCity: ship?.city ?? "",
      shipState: ship?.state ?? "",
      shipZip: ship?.zip ?? "",
      shipCountry: ship?.country ?? "",
    }))
  }

  async function handleSave() {
    if (!form.clientId) {
      setError("Please select a client.")
      return
    }

    setSaving(true)
    setError("")

    const res = await fetch("/api/sales-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Something went wrong creating this Sales Order.")
      setSaving(false)
      return
    }

    const so = await res.json()
    router.push(`/dashboard/sales-orders/${so.id}`)
  }

  return (
    <div className="w-full max-w-4xl space-y-6">
      <h1 className="text-display font-semibold tracking-tight text-foreground">New Sales Order</h1>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
        <h2 className="font-semibold text-sm text-foreground">Client</h2>
        <select
          value={form.clientId}
          onChange={(e) => handleClientSelect(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select a client...</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Client PO #</label>
            <input
              type="text"
              value={form.clientPoNumber}
              onChange={(e) => update("clientPoNumber", e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Payment Terms</label>
            <select
              value={form.paymentTerms}
              onChange={(e) => update("paymentTerms", e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Not set</option>
              <option value="Due on Receipt">Due on Receipt</option>
              <option value="Net15">Net 15</option>
              <option value="Net30">Net 30</option>
              <option value="Net45">Net 45</option>
              <option value="Net60">Net 60</option>
              <option value="Prepaid">Prepaid</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">Bill To</h2>
          <p className="text-xs text-muted-foreground">
            Auto-filled from the client&apos;s main billing location — edit freely if this order bills differently.
          </p>
          <input
            type="text"
            placeholder="Contact Name"
            value={form.billContactName}
            onChange={(e) => update("billContactName", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Address"
            value={form.billAddress}
            onChange={(e) => update("billAddress", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Suite, Apt, Unit (optional)"
            value={form.billAddress2}
            onChange={(e) => update("billAddress2", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="City"
              value={form.billCity}
              onChange={(e) => update("billCity", e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="State"
              value={form.billState}
              onChange={(e) => update("billState", e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="Zip"
              value={form.billZip}
              onChange={(e) => update("billZip", e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <input
            type="text"
            placeholder="Country"
            value={form.billCountry}
            onChange={(e) => update("billCountry", e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">Ship To</h2>
          <p className="text-xs text-muted-foreground">
            Auto-filled from the client&apos;s main shipping location — edit freely if this order ships differently.
          </p>
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
          placeholder="Not visible to the client"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push("/dashboard/sales-orders")}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Creating..." : "Create Sales Order"}
        </Button>
      </div>
    </div>
  )
}