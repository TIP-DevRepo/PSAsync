"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function NewVendorPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    name: "",
    type: "SUPPLIER",
    status: "ACTIVE",
    email: "",
    phone: "",
    website: "",
    address: "",
    paymentTerms: "",
    leadTimeDays: "",
    notes: "",
    isDistributor: false,
    isVendor: true,
    isManufacturer: false,
  })

  function update(field: string, value: string | boolean) {
    setForm({ ...form, [field]: value })
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Vendor name is required.")
      return
    }

    setSaving(true)
    setError("")

    const res = await fetch("/api/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      setError("Something went wrong saving this vendor.")
      setSaving(false)
      return
    }

    const vendor = await res.json()
    router.push(`/dashboard/vendors/${vendor.id}`)
  }

  return (
    <div className="w-full space-y-6:">
      <h1 className="text-2xl font-bold">Add Vendor</h1>

      <div className="rounded-md border p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Vendor Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => update("type", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="SUPPLIER">Supplier</option>
              <option value="SUBCONTRACTOR">Subcontractor</option>
              <option value="PARTNER">Partner</option>
              <option value="DISTRIBUTOR">Distributor</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="PREFERRED">Preferred</option>
            </select>
          </div>
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
          <label className="block text-sm font-medium mb-1">Address</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Payment Terms</label>
            <select
              value={form.paymentTerms}
              onChange={(e) => update("paymentTerms", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
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
          <div>
            <label className="block text-sm font-medium mb-1">Lead Time (days)</label>
            <input
              type="number"
              value={form.leadTimeDays}
              onChange={(e) => update("leadTimeDays", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isVendor}
              onChange={(e) => update("isVendor", e.target.checked)}
            />
            Vendor (I can buy from them)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isManufacturer}
              onChange={(e) => update("isManufacturer", e.target.checked)}
            />
            Manufacturer (they make the item)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isDistributor}
              onChange={(e) => update("isDistributor", e.target.checked)}
            />
            Distributor (for quote pricing lookups)
          </label>
        </div>
      </div>

      <div className="rounded-md border p-4">
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Vendor"}
      </Button>
    </div>
  )
}