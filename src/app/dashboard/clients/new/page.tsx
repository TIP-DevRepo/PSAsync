"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { formatPhoneInput } from "@/lib/phone"

export default function NewClientPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [industries, setIndustries] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch("/api/industries")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setIndustries(data))
  }, [])

  const [form, setForm] = useState({
    name: "",
    prefix: "",
    email: "",
    phone: "",
    website: "",
    industryId: "",
    status: "PROSPECT",
    paymentTerms: "",
    isInternal: false,
    notes: "",
  })

  function update(field: string, value: string | boolean) {
    setForm({ ...form, [field]: value })
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Company name is required.")
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
          <label className="block text-sm font-medium mb-1">Company Prefix</label>
          <input
            type="text"
            value={form.prefix}
            onChange={(e) => update("prefix", e.target.value.toUpperCase())}
            placeholder="e.g. ACM"
            maxLength={10}
            className="w-full rounded-md border px-3 py-2 text-sm uppercase"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            A short code used to identify this client across the platform, including generating Asset Tags for their hardware (e.g. ACM-0001). Can be added later, but is required before hardware can be received for this client.
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
              onChange={(e) => update("phone", formatPhoneInput(e.target.value))}
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
            <Combobox
              options={industries.map((i) => ({ id: i.id, label: i.name }))}
              value={form.industryId}
              onChange={(id) => update("industryId", id)}
              onCreate={async (label) => {
                const res = await fetch("/api/industries", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: label }),
                })
                const created = await res.json()
                setIndustries((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
                return { id: created.id, label: created.name }
              }}
              placeholder="Search or create an industry..."
              emptyLabel="No industry selected"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
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
        </div>

        <label className="flex items-center gap-2 text-sm pt-1">
          <input
            type="checkbox"
            checked={form.isInternal}
            onChange={(e) => update("isInternal", e.target.checked)}
            className="accent-primary"
          />
          This is your own company
        </label>
        <p className="text-xs text-muted-foreground">
          Marking this client as your own company makes its locations available as ship-to options on Purchase Orders. Only one client can be marked this way.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Billing and shipping locations are added from the client&apos;s Locations tab after it&apos;s created.
      </p>

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