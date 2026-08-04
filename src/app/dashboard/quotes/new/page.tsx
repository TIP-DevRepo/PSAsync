"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ContactSearchInput, type ContactSearchResult } from "@/components/ContactSearchInput"

// ─── Types ────────────────────────────────────────────────────────────────
interface UserOption {
  id: string
  name: string
  active: boolean
}

interface Template {
  id: string
  name: string
  introText: string | null
  terms: string | null
  expiryDays: number
}

function addDaysIso(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ─── Page wrapper (Suspense required for useSearchParams) ──────────────────
export default function NewQuotePage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading...</p>}>
      <NewQuoteForm />
    </Suspense>
  )
}

function NewQuoteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const templateId = searchParams.get("template")

  const [users, setUsers] = useState<UserOption[]>([])
  const [template, setTemplate] = useState<Template | null>(null)
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    userId: "",
    title: "",
    introText: "",
    internalNotes: "",
    expiresAt: addDaysIso(30),
    shipAddress: "",
    shipAddress2: "",
    shipCity: "",
    shipState: "",
    shipZip: "",
    shipCountry: "",
    paymentTerms: "",
  })

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Load users on mount, redirect to the template picker if no template was chosen
  useEffect(() => {
    if (!templateId) {
      router.replace("/dashboard/quotes")
      return
    }

    fetch("/api/users")
      .then((res) => res.json())
      .then((all: UserOption[]) => setUsers(all.filter((u) => u.active)))

    fetch(`/api/quote-templates/${templateId}`)
      .then((res) => res.json())
      .then((t: Template) => {
        setTemplate(t)
        setForm((prev) => ({
          ...prev,
          introText: t.introText || "",
          expiresAt: addDaysIso(t.expiryDays || 30),
        }))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId])

  function handleContactSelect(contact: ContactSearchResult) {
    setSelectedContact(contact)
    // Autofill shipping address from the client's main shipping location,
    // falling back to their main billing location if no shipping location
    // is set. Stays independently editable from this point on — doesn't
    // write back to the client's record.
    const loc = contact.client.mainShippingLocation ?? contact.client.mainBillingLocation
    setForm((prev) => ({
      ...prev,
      shipAddress: loc?.address ?? "",
      shipAddress2: loc?.address2 ?? "",
      shipCity: loc?.city ?? "",
      shipState: loc?.state ?? "",
      shipZip: loc?.zip ?? "",
      shipCountry: loc?.country ?? "",
      paymentTerms: contact.client.paymentTerms ?? "",
    }))
  }

  async function handleSave() {
    if (!selectedContact) {
      setError("Please search for and select a contact.")
      return
    }

    setSaving(true)
    setError("")

    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        clientId: selectedContact.client.id,
        contactId: selectedContact.id,
        templateId,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Something went wrong creating this quote.")
      setSaving(false)
      return
    }

    const quote = await res.json()
    router.push(`/dashboard/quotes/${quote.id}`)
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">New Quote</h1>
        {template && (
          <span className="text-sm text-zinc-500">Template: {template.name}</span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Left: main content */}
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-md border p-4 space-y-3">
            <h2 className="font-semibold text-sm">Who is this quote for?</h2>

            <ContactSearchInput onSelect={handleContactSelect} />

            {selectedContact && (
              <div className="rounded-md border p-3 text-sm space-y-0.5 bg-zinc-50 dark:bg-zinc-900">
                <p className="font-medium">
                  {selectedContact.firstName} {selectedContact.lastName}
                  {selectedContact.title && <span className="text-zinc-500"> — {selectedContact.title}</span>}
                </p>
                <p className="text-zinc-500">{selectedContact.client.name}</p>
                {selectedContact.email && <p className="text-zinc-500">{selectedContact.email}</p>}
                {selectedContact.phone && <p className="text-zinc-500">{selectedContact.phone}</p>}
              </div>
            )}
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <h2 className="font-semibold text-sm">Quote Details</h2>

            <div>
              <label className="block text-sm font-medium mb-1">Title / Subject</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="e.g. Q3 Network Upgrade"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Payment Terms</label>
              <select
                value={form.paymentTerms}
                onChange={(e) => update("paymentTerms", e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Select terms...</option>
                <option value="Due on Receipt">Due on Receipt</option>
                <option value="Net15">Net15</option>
                <option value="Net30">Net30</option>
                <option value="Net45">Net45</option>
                <option value="Net60">Net60</option>
                <option value="Prepaid">Prepaid</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => update("expiresAt", e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Assigned Rep</label>
                <select
                  value={form.userId}
                  onChange={(e) => update("userId", e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Me (default)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Client-Facing Intro Message</label>
              <textarea
                value={form.introText}
                onChange={(e) => update("introText", e.target.value)}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Internal Notes</label>
              <textarea
                value={form.internalNotes}
                onChange={(e) => update("internalNotes", e.target.value)}
                rows={2}
                placeholder="Not visible to the client"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Right: Shipping Address */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-md border p-4 space-y-3">
            <h2 className="font-semibold text-sm">Shipping Address</h2>
            <p className="text-xs text-zinc-500">
              Autofilled from the selected contact's company — edit freely if this quote ships somewhere different.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Address</label>
              <input
                type="text"
                value={form.shipAddress}
                onChange={(e) => update("shipAddress", e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Suite, Apt, Unit (optional)</label>
              <input
                type="text"
                value={form.shipAddress2}
                onChange={(e) => update("shipAddress2", e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">City</label>
                <input
                  type="text"
                  value={form.shipCity}
                  onChange={(e) => update("shipCity", e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">State</label>
                <input
                  type="text"
                  value={form.shipState}
                  onChange={(e) => update("shipState", e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Zip</label>
                <input
                  type="text"
                  value={form.shipZip}
                  onChange={(e) => update("shipZip", e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Country</label>
              <input
                type="text"
                value={form.shipCountry}
                onChange={(e) => update("shipCountry", e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push("/dashboard/quotes")}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Creating..." : "Create Quote"}
        </Button>
      </div>
    </div>
  )
}