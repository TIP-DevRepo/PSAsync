"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function NewClientPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    name: "",
    prefix: "",
    email: "",
    phone: "",
    website: "",
    industry: "",
    status: "PROSPECT",
    billAddress: "",
    billCity: "",
    billState: "",
    billZip: "",
    billCountry: "US",
    shipAddress: "",
    shipCity: "",
    shipState: "",
    shipZip: "",
    shipCountry: "US",
    notes: "",
  })

  function update(field: string, value: string) {
    setForm({ ...form, [field]: value })
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Company name is required.")
      return
    }
    if (!form.prefix.trim()) {
      setError("Company Prefix is required.")
      return
    }

    setSaving(true)
    setError("")

    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      setError("Something went wrong saving this client.")
      setSaving(false)
      return
    }

    const client = await res.json()
    router.push(`/dashboard/clients/${client.id}`)
  }

  return (
    <div className="w-full space-y-6:">
      <h1 className="text-2xl font-bold">Add Client</h1>

      {/* Core Info */}
      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Core Info</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Company Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Company Prefix *</label>
          <input
            type="text"
            value={form.prefix}
            onChange={(e) => update("prefix", e.target.value.toUpperCase())}
            placeholder="e.g. ACM"
            maxLength={10}
            className="w-full rounded-md border px-3 py-2 text-sm uppercase"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            A short code used to identify this client across the platform, including generating Asset Tags for their hardware (e.g. ACM-0001).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Website</label>
            <input
              type="text"
              value={form.website}
              onChange={(e) => update("website", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Industry</label>
            <input
              type="text"
              value={form.industry}
              onChange={(e) => update("industry", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="PROSPECT">Prospect</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="LOST">Lost</option>
          </select>
        </div>
      </div>

      {/* Billing Address */}
      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Billing Address</h2>
        <input
          type="text"
          placeholder="Street Address"
          value={form.billAddress}
          onChange={(e) => update("billAddress", e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="City"
            value={form.billCity}
            onChange={(e) => update("billCity", e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="State"
            value={form.billState}
            onChange={(e) => update("billState", e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Zip"
            value={form.billZip}
            onChange={(e) => update("billZip", e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Shipping Address */}
      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Shipping Address</h2>
        <input
          type="text"
          placeholder="Street Address"
          value={form.shipAddress}
          onChange={(e) => update("shipAddress", e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="City"
            value={form.shipCity}
            onChange={(e) => update("shipCity", e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="State"
            value={form.shipState}
            onChange={(e) => update("shipState", e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Zip"
            value={form.shipZip}
            onChange={(e) => update("shipZip", e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Notes</h2>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Client"}
      </Button>
    </div>
  )
}