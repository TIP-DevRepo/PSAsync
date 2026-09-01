"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CategoryPicker } from "@/components/categories/CategoryPicker"

const UNIT_OPTIONS = [
  { value: "each", label: "Each" },
  { value: "hour", label: "Hour" },
  { value: "user", label: "User" },
  { value: "device", label: "Device" },
  { value: "gb", label: "GB" },
  { value: "license", label: "License" },
]

interface VendorOption {
  id: string
  name: string
  isVendor: boolean
  isManufacturer: boolean
}

export default function NewCatalogItemPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [vendors, setVendors] = useState<VendorOption[]>([])

  const [form, setForm] = useState({
    name: "",
    description: "",
    categoryId: "",
    isSerialized: false,
    type: "PHYSICAL",
    msrp: "",
    cost: "",
    unit: "each",
    taxable: true,
    active: true,
    vendorId: "",
    vendorSku: "",
    manufacturerId: "",
    manufacturerSku: "",
  })

  useEffect(() => {
    fetch("/api/vendors")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setVendors(data))
  }, [])

  function update(field: string, value: string | boolean) {
    setForm({ ...form, [field]: value })
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Item name is required.")
      return
    }
    if (!form.categoryId) {
      setError("Category is required.")
      return
    }

    setSaving(true)
    setError("")

    const res = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      setError("Something went wrong saving this item.")
      setSaving(false)
      return
    }

    const item = await res.json()
    router.push(`/dashboard/catalog/${item.id}`)
  }

  const vendorOptions = vendors.filter((v) => v.isVendor)
  const manufacturerOptions = vendors.filter((v) => v.isManufacturer)

  return (
    <div className="w-full space-y-6">
      <h1 className="text-2xl font-bold">Add Catalog Item</h1>

      <div className="rounded-md border p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Item Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
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
              <option value="PHYSICAL">Physical</option>
              <option value="SERVICE">Service</option>
              <option value="SUBSCRIPTION">Subscription</option>
              <option value="BUNDLE">Bundle</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Billing Unit</label>
            <select
              value={form.unit}
              onChange={(e) => update("unit", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>
        </div>

        <CategoryPicker
          value={form.categoryId}
          onChange={(categoryId) => update("categoryId", categoryId)}
          onDefaultsChange={(defaults) => update("isSerialized", defaults.isSerialized)}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isSerialized}
            onChange={(e) => update("isSerialized", e.target.checked)}
          />
          Serialized (tracked as individual units in Inventory, e.g. laptops, switches)
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cost Price ($)</label>
            <input
              type="number"
              step="0.01"
              value={form.cost}
              onChange={(e) => update("cost", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">MSRP ($)</label>
            <input
              type="number"
              step="0.01"
              value={form.msrp}
              onChange={(e) => update("msrp", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.taxable}
              onChange={(e) => update("taxable", e.target.checked)}
            />
            Taxable
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => update("active", e.target.checked)}
            />
            Active
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor</label>
            <select
              value={form.vendorId}
              onChange={(e) => update("vendorId", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Not set</option>
              {vendorOptions.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Vendor SKU</label>
            <input
              type="text"
              value={form.vendorSku}
              onChange={(e) => update("vendorSku", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Manufacturer</label>
            <select
              value={form.manufacturerId}
              onChange={(e) => update("manufacturerId", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Not set</option>
              {manufacturerOptions.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Manufacturer SKU</label>
            <input
              type="text"
              value={form.manufacturerSku}
              onChange={(e) => update("manufacturerSku", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Item"}
      </Button>
    </div>
  )
}