"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface CatalogItemDetail {
  id: string
  name: string
  description: string | null
  sku: string | null
  category: string | null
  subcategory: string | null
  type: string
  msrp: number
  cost: number
  unit: string
  taxable: boolean
  active: boolean
}

export default function CatalogItemDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [item, setItem] = useState<CatalogItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/catalog/${id}`)
      .then((res) => res.json())
      .then((json) => {
        setItem(json)
        setLoading(false)
      })
  }, [id])

  function update(field: string, value: string | number | boolean) {
    if (item) setItem({ ...item, [field]: value })
  }

  async function handleSave() {
    if (!item) return
    setSaving(true)

    const res = await fetch(`/api/catalog/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })

    setSaving(false)
    if (res.ok) {
      toast.success("Item saved")
    } else {
      toast.error("Couldn't save item")
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  if (!item) {
    return <p className="text-sm text-red-600">Item not found.</p>
  }

  return (
    <div className="w-full space-y-6:">
      <div>
        <Link href="/dashboard/catalog" className="text-sm text-zinc-500 hover:underline inline-block mb-2">
          ← Back to Catalog
        </Link>
        <h1 className="text-2xl font-bold">{item.name}</h1>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Item Name</label>
          <input
            type="text"
            value={item.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={item.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">SKU</label>
            <input
              type="text"
              value={item.sku ?? ""}
              onChange={(e) => update("sku", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={item.type}
              onChange={(e) => update("type", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="PHYSICAL">Physical</option>
              <option value="SERVICE">Service</option>
              <option value="SUBSCRIPTION">Subscription</option>
              <option value="BUNDLE">Bundle</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <input
              type="text"
              value={item.category ?? ""}
              onChange={(e) => update("category", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Subcategory</label>
            <input
              type="text"
              value={item.subcategory ?? ""}
              onChange={(e) => update("subcategory", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cost Price ($)</label>
            <input
              type="number"
              step="0.01"
              value={item.cost}
              onChange={(e) => update("cost", Number(e.target.value))}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">MSRP ($)</label>
            <input
              type="number"
              step="0.01"
              value={item.msrp}
              onChange={(e) => update("msrp", Number(e.target.value))}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Unit</label>
            <input
              type="text"
              value={item.unit}
              onChange={(e) => update("unit", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.taxable}
              onChange={(e) => update("taxable", e.target.checked)}
            />
            Taxable
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.active}
              onChange={(e) => update("active", e.target.checked)}
            />
            Active
          </label>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}