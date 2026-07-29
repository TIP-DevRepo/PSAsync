"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface Contact {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
}

interface ClientDetail {
  id: string
  name: string
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  status: string
  billAddress: string | null
  billCity: string | null
  billState: string | null
  billZip: string | null
  shipAddress: string | null
  shipCity: string | null
  shipState: string | null
  shipZip: string | null
  notes: string | null
  contacts: Contact[]
}

export default function ClientDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"details" | "contacts">("details")

  // New contact form state
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({
    firstName: "",
    lastName: "",
    title: "",
    email: "",
    phone: "",
    isPrimary: false,
  })

  function loadClient() {
    fetch(`/api/clients/${id}`)
      .then((res) => res.json())
      .then((json) => {
        setClient(json)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadClient()
  }, [id])

  async function handleAddContact() {
    const res = await fetch(`/api/clients/${id}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newContact),
    })
    if (res.ok) {
      toast.success("Contact added")
    } else {
      toast.error("Couldn't add contact")
    }
    setNewContact({ firstName: "", lastName: "", title: "", email: "", phone: "", isPrimary: false })
    setShowAddContact(false)
    loadClient()
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  if (!client) {
    return <p className="text-sm text-red-600">Client not found.</p>
  }

  return (
    <div className="w-full space-y-6:">
      <div>
        <Link href="/dashboard/clients" className="text-sm text-zinc-500 hover:underline inline-block mb-2">
          ← Back to Clients
        </Link>
        <h1 className="text-2xl font-bold">{client.name}</h1>
        <p className="text-sm text-zinc-500">{client.industry ?? "No industry set"}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b text-sm">
        <button
          onClick={() => setActiveTab("details")}
          className={`pb-2 ${activeTab === "details" ? "border-b-2 border-zinc-900 font-semibold dark:border-zinc-100" : "text-zinc-500"}`}
        >
          Details
        </button>
        <button
          onClick={() => setActiveTab("contacts")}
          className={`pb-2 ${activeTab === "contacts" ? "border-b-2 border-zinc-900 font-semibold dark:border-zinc-100" : "text-zinc-500"}`}
        >
          Contacts ({client.contacts.length})
        </button>
      </div>

      {/* Details Tab */}
      {activeTab === "details" && (
        <div className="space-y-4">
          <div className="rounded-md border p-4 space-y-2 text-sm">
            <p><span className="font-medium">Status:</span> {client.status}</p>
            <p><span className="font-medium">Email:</span> {client.email ?? "—"}</p>
            <p><span className="font-medium">Phone:</span> {client.phone ?? "—"}</p>
            <p><span className="font-medium">Website:</span> {client.website ?? "—"}</p>
          </div>

          <div className="rounded-md border p-4 space-y-1 text-sm">
            <h3 className="font-semibold mb-1">Billing Address</h3>
            <p>{client.billAddress ?? "—"}</p>
            <p>{[client.billCity, client.billState, client.billZip].filter(Boolean).join(", ")}</p>
          </div>

          <div className="rounded-md border p-4 space-y-1 text-sm">
            <h3 className="font-semibold mb-1">Shipping Address</h3>
            <p>{client.shipAddress ?? "—"}</p>
            <p>{[client.shipCity, client.shipState, client.shipZip].filter(Boolean).join(", ")}</p>
          </div>

          {client.notes && (
            <div className="rounded-md border p-4 text-sm">
              <h3 className="font-semibold mb-1">Notes</h3>
              <p>{client.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Contacts Tab */}
      {activeTab === "contacts" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowAddContact(!showAddContact)}>
              {showAddContact ? "Cancel" : "Add Contact"}
            </Button>
          </div>

          {showAddContact && (
            <div className="rounded-md border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="First Name"
                  value={newContact.firstName}
                  onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                  className="rounded-md border px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={newContact.lastName}
                  onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                  className="rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <input
                type="text"
                placeholder="Title"
                value={newContact.title}
                onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  className="rounded-md border px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Phone"
                  value={newContact.phone}
                  onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  className="rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newContact.isPrimary}
                  onChange={(e) => setNewContact({ ...newContact, isPrimary: e.target.checked })}
                />
                Set as primary contact
              </label>
              <Button onClick={handleAddContact}>Save Contact</Button>
            </div>
          )}

          <div className="space-y-2">
            {client.contacts.map((contact) => (
              <div key={contact.id} className="rounded-md border p-3 text-sm flex justify-between items-center">
                <div>
                  <p className="font-medium">
                    {contact.firstName} {contact.lastName}
                    {contact.isPrimary && (
                      <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Primary</span>
                    )}
                  </p>
                  <p className="text-zinc-500">{contact.title}</p>
                  <p className="text-zinc-500">{contact.email} {contact.phone && `· ${contact.phone}`}</p>
                </div>
              </div>
            ))}
            {client.contacts.length === 0 && (
              <p className="text-sm text-zinc-500">No contacts yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}