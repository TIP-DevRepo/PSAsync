"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { TabsBar } from "@/components/ui/tabs-bar"
import { Combobox } from "@/components/ui/combobox"
import { Modal } from "@/components/Modal"
import { Ticket, Target, Package, FileText, KeyRound, FolderOpen, Radar } from "lucide-react"

interface Contact {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  locationType: "REMOTE" | "IN_OFFICE"
  locationId: string | null
  isPrimary: boolean
  notes: string | null
}

interface ClientLocation {
  id: string
  name: string
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
  billingContactId: string | null
  billingContact: Contact | null
  shippingContactId: string | null
  shippingContact: Contact | null
}

interface ClientDetail {
  id: string
  name: string
  email: string | null
  phone: string | null
  website: string | null
  industryId: string | null
  industryRef: { id: string; name: string } | null
  status: string
  notes: string | null
  contacts: Contact[]
  locations: ClientLocation[]
  mainBillingLocationId: string | null
  mainBillingLocation: ClientLocation | null
  mainShippingLocationId: string | null
  mainShippingLocation: ClientLocation | null
}

type ClientTabKey =
  | "details"
  | "locations"
  | "contacts"
  | "tickets"
  | "opportunities"
  | "assets"
  | "contracts"
  | "licenses"
  | "documents"
  | "engagement"

const CLIENT_TABS: { key: ClientTabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "locations", label: "Locations" },
  { key: "contacts", label: "Contacts" },
  { key: "tickets", label: "Tickets" },
  { key: "opportunities", label: "Opportunities" },
  { key: "assets", label: "Assets" },
  { key: "contracts", label: "Contracts" },
  { key: "licenses", label: "Licenses & Subscriptions" },
  { key: "documents", label: "Documents" },
  { key: "engagement", label: "Engagement Hub" },
]

type StatusFilter = "OPEN" | "CLOSED" | "ALL"

function FilterPills({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  const options: { key: StatusFilter; label: string }[] = [
    { key: "OPEN", label: "Open" },
    { key: "CLOSED", label: "Closed" },
    { key: "ALL", label: "All" },
  ]
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === o.key ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PlaceholderPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Ticket
  title: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">{description}</p>
    </div>
  )
}

function contactName(c: Contact | null) {
  return c ? `${c.firstName} ${c.lastName}` : "—"
}

function locationAddress(loc: ClientLocation | null) {
  if (!loc) return "—"
  const cityStateZip = [loc.city, loc.state, loc.zip].filter(Boolean).join(", ")
  return [loc.address, loc.address2, cityStateZip, loc.country].filter(Boolean).join(" · ") || loc.name
}

export default function ClientDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<ClientTabKey>("details")
  const [ticketFilter, setTicketFilter] = useState<StatusFilter>("OPEN")
  const [oppFilter, setOppFilter] = useState<StatusFilter>("OPEN")

  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsDraft, setDetailsDraft] = useState({
    name: "",
    industryId: "",
    email: "",
    phone: "",
    website: "",
    status: "",
    notes: "",
    mainBillingLocationId: "",
    mainShippingLocationId: "",
  })

  const [showAddLocation, setShowAddLocation] = useState(false)
  const [newLocation, setNewLocation] = useState({
    name: "",
    address: "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    phone: "",
    notes: "",
    isPrimary: false,
  })
  const [viewingLocation, setViewingLocation] = useState<ClientLocation | null>(null)

  const [contactSearch, setContactSearch] = useState("")
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({
    firstName: "",
    lastName: "",
    title: "",
    email: "",
    phone: "",
    mobile: "",
    locationType: "IN_OFFICE" as "REMOTE" | "IN_OFFICE",
    locationId: "",
    notes: "",
    isPrimary: false,
  })
  const [viewingContact, setViewingContact] = useState<Contact | null>(null)

  const [industries, setIndustries] = useState<{ id: string; name: string }[]>([])

  function loadIndustries() {
    fetch("/api/industries")
      .then((res) => res.json())
      .then((data) => setIndustries(data))
  }

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
    loadIndustries()
  }, [id])

  // ─── Details tab ────────────────────────────────────────────────────
  function startEditingDetails() {
    if (!client) return
    setDetailsDraft({
      name: client.name,
      industryId: client.industryId ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      website: client.website ?? "",
      status: client.status,
      notes: client.notes ?? "",
      mainBillingLocationId: client.mainBillingLocationId ?? "",
      mainShippingLocationId: client.mainShippingLocationId ?? "",
    })
    setEditingDetails(true)
  }

  async function handleSaveDetails() {
    const res = await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detailsDraft),
    })
    if (res.ok) {
      toast.success("Client details saved")
      setEditingDetails(false)
      loadClient()
    } else {
      toast.error("Couldn't save client details")
    }
  }

  // ─── Locations tab ──────────────────────────────────────────────────
  async function handleAddLocation() {
    const res = await fetch(`/api/clients/${id}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newLocation),
    })
    if (res.ok) {
      toast.success("Location added")
    } else {
      toast.error("Couldn't add location")
    }
    setNewLocation({ name: "", address: "", address2: "", city: "", state: "", zip: "", country: "", phone: "", notes: "", isPrimary: false })
    setShowAddLocation(false)
    loadClient()
  }

  async function handleSaveLocation(locationId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/clients/${id}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      toast.success("Location saved")
      setViewingLocation(null)
      loadClient()
    } else {
      toast.error("Couldn't save location")
    }
  }

  // ─── Contacts tab ───────────────────────────────────────────────────
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
    setNewContact({
      firstName: "",
      lastName: "",
      title: "",
      email: "",
      phone: "",
      mobile: "",
      locationType: "IN_OFFICE",
      locationId: "",
      notes: "",
      isPrimary: false,
    })
    setShowAddContact(false)
    loadClient()
  }

  async function handleSaveContact(contactId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/clients/${id}/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      toast.success("Contact saved")
      setViewingContact(null)
      loadClient()
    } else {
      toast.error("Couldn't save contact")
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!client) {
    return <p className="text-sm text-danger">Client not found.</p>
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/clients" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-block mb-2">
          ← Back to Clients
        </Link>
        <h1 className="text-display font-semibold tracking-tight text-foreground">{client.name}</h1>
        <p className="text-sm text-muted-foreground">{client.industryRef?.name ?? "No industry set"}</p>
      </div>

      <TabsBar tabs={CLIENT_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Client sections" />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "details" && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              {editingDetails ? (
                <>
                  <Button variant="outline" onClick={() => setEditingDetails(false)}>Cancel</Button>
                  <Button onClick={handleSaveDetails}>Save</Button>
                </>
              ) : (
                <Button variant="outline" onClick={startEditingDetails}>Edit</Button>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3 text-sm">
              {!editingDetails ? (
                <>
                  <p><span className="font-medium text-foreground">Status:</span> <span className="text-muted-foreground">{client.status}</span></p>
                  <p><span className="font-medium text-foreground">Email:</span> <span className="text-muted-foreground">{client.email ?? "—"}</span></p>
                  <p><span className="font-medium text-foreground">Phone:</span> <span className="text-muted-foreground">{client.phone ?? "—"}</span></p>
                  <p>
                    <span className="font-medium text-foreground">Website:</span>{" "}
                    {client.website ? (
                      <a
                        href={client.website.startsWith("http") ? client.website : `https://${client.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {client.website}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Client Name</label>
                    <input
                      type="text"
                      value={detailsDraft.name}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, name: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Industry</label>
                    <Combobox
                      options={industries.map((i) => ({ id: i.id, label: i.name }))}
                      value={detailsDraft.industryId}
                      onChange={(id) => setDetailsDraft({ ...detailsDraft, industryId: id })}
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
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Status</label>
                    <select
                      value={detailsDraft.status}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, status: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="PROSPECT">Prospect</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="LOST">Lost</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Email</label>
                    <input
                      type="email"
                      value={detailsDraft.email}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, email: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Phone</label>
                    <input
                      type="text"
                      value={detailsDraft.phone}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, phone: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Website</label>
                    <input
                      type="text"
                      value={detailsDraft.website}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, website: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-2 text-sm">
              <h3 className="font-semibold mb-1 text-foreground">Main Billing Address</h3>
              {!editingDetails ? (
                client.mainBillingLocation ? (
                  <>
                    <p className="text-muted-foreground">{client.mainBillingLocation.name}</p>
                    <p className="text-muted-foreground">{locationAddress(client.mainBillingLocation)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Billing contact: {contactName(client.mainBillingLocation.billingContact)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">No billing location selected.</p>
                )
              ) : (
                <select
                  value={detailsDraft.mainBillingLocationId}
                  onChange={(e) => setDetailsDraft({ ...detailsDraft, mainBillingLocationId: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">No billing location selected</option>
                  {client.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-2 text-sm">
              <h3 className="font-semibold mb-1 text-foreground">Main Shipping Address</h3>
              {!editingDetails ? (
                client.mainShippingLocation ? (
                  <>
                    <p className="text-muted-foreground">{client.mainShippingLocation.name}</p>
                    <p className="text-muted-foreground">{locationAddress(client.mainShippingLocation)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Shipping contact: {contactName(client.mainShippingLocation.shippingContact)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">No shipping location selected.</p>
                )
              ) : (
                <select
                  value={detailsDraft.mainShippingLocationId}
                  onChange={(e) => setDetailsDraft({ ...detailsDraft, mainShippingLocationId: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">No shipping location selected</option>
                  {client.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              )}
            </div>

            {(client.notes || editingDetails) && (
              <div className="rounded-lg border border-border bg-card shadow-card p-4 text-sm space-y-2">
                <h3 className="font-semibold mb-1 text-foreground">Notes</h3>
                {!editingDetails ? (
                  <p className="text-muted-foreground">{client.notes}</p>
                ) : (
                  <textarea
                    value={detailsDraft.notes}
                    onChange={(e) => setDetailsDraft({ ...detailsDraft, notes: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "locations" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setShowAddLocation(!showAddLocation)}>
                {showAddLocation ? "Cancel" : "Add Location"}
              </Button>
            </div>

            {showAddLocation && (
              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
                <input
                  type="text"
                  placeholder="Location Name (e.g. Headquarters, Warehouse)"
                  value={newLocation.name}
                  onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="text"
                  placeholder="Address"
                  value={newLocation.address}
                  onChange={(e) => setNewLocation({ ...newLocation, address: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="text"
                  placeholder="Suite, Apt, Unit (optional)"
                  value={newLocation.address2}
                  onChange={(e) => setNewLocation({ ...newLocation, address2: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="City"
                    value={newLocation.city}
                    onChange={(e) => setNewLocation({ ...newLocation, city: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <input
                    type="text"
                    placeholder="State"
                    value={newLocation.state}
                    onChange={(e) => setNewLocation({ ...newLocation, state: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <input
                    type="text"
                    placeholder="Zip"
                    value={newLocation.zip}
                    onChange={(e) => setNewLocation({ ...newLocation, zip: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Country"
                  value={newLocation.country}
                  onChange={(e) => setNewLocation({ ...newLocation, country: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="text"
                  placeholder="Phone"
                  value={newLocation.phone}
                  onChange={(e) => setNewLocation({ ...newLocation, phone: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <textarea
                  placeholder="Notes (optional)"
                  value={newLocation.notes}
                  onChange={(e) => setNewLocation({ ...newLocation, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={newLocation.isPrimary}
                    onChange={(e) => setNewLocation({ ...newLocation, isPrimary: e.target.checked })}
                    className="accent-primary"
                  />
                  Set as primary location
                </label>
                <p className="text-xs text-muted-foreground">
                  Billing/shipping contacts for this location can be set after creating it — open the location once it's added.
                </p>
                <Button onClick={handleAddLocation}>Save Location</Button>
              </div>
            )}

            <div className="space-y-2">
              {client.locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => setViewingLocation(loc)}
                  className="w-full text-left rounded-lg border border-border bg-card shadow-card p-3 text-sm hover:bg-surface-hover transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-foreground">
                        {loc.name}
                        {loc.isPrimary && (
                          <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info">Primary</span>
                        )}
                      </p>
                      <p className="text-muted-foreground">{locationAddress(loc)}</p>
                    </div>
                  </div>
                </button>
              ))}
              {client.locations.length === 0 && (
                <p className="text-sm text-muted-foreground">No locations yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "contacts" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="w-64 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button onClick={() => setShowAddContact(!showAddContact)}>
                {showAddContact ? "Cancel" : "Add Contact"}
              </Button>
            </div>

            {showAddContact && (
              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="First Name"
                    value={newContact.firstName}
                    onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={newContact.lastName}
                    onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Title"
                  value={newContact.title}
                  onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Work Phone"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <input
                    type="text"
                    placeholder="Cell Phone"
                    value={newContact.mobile}
                    onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={newContact.locationType}
                    onChange={(e) => setNewContact({ ...newContact, locationType: e.target.value as "REMOTE" | "IN_OFFICE" })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="IN_OFFICE">In-Office</option>
                    <option value="REMOTE">Remote</option>
                  </select>
                  <select
                    value={newContact.locationId}
                    onChange={(e) => setNewContact({ ...newContact, locationId: e.target.value })}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">No location</option>
                    {client.locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  placeholder="Notes (optional)"
                  value={newContact.notes}
                  onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={newContact.isPrimary}
                    onChange={(e) => setNewContact({ ...newContact, isPrimary: e.target.checked })}
                    className="accent-primary"
                  />
                  Set as primary contact
                </label>
                <Button onClick={handleAddContact}>Save Contact</Button>
              </div>
            )}

            <div className="space-y-2">
              {client.contacts
                .filter((c) => {
                  const q = contactSearch.toLowerCase()
                  if (!q) return true
                  return (
                    `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
                    (c.title ?? "").toLowerCase().includes(q) ||
                    (c.email ?? "").toLowerCase().includes(q) ||
                    (c.phone ?? "").toLowerCase().includes(q) ||
                    (c.mobile ?? "").toLowerCase().includes(q)
                  )
                })
                .sort((a, b) =>
                  `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
                )
                .map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => setViewingContact(contact)}
                    className="w-full text-left rounded-lg border border-border bg-card shadow-card p-3 text-sm hover:bg-surface-hover transition-colors"
                  >
                    <p className="font-medium text-foreground">
                      {contact.firstName} {contact.lastName}
                      {contact.isPrimary && (
                        <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info">Primary</span>
                      )}
                    </p>
                    <p className="text-muted-foreground">{contact.title}</p>
                    <p className="text-muted-foreground">{contact.email} {contact.phone && `· ${contact.phone}`}</p>
                  </button>
                ))}
              {client.contacts.length === 0 && (
                <p className="text-sm text-muted-foreground">No contacts yet.</p>
              )}
              {client.contacts.length > 0 &&
                client.contacts.filter((c) =>
                  `${c.firstName} ${c.lastName} ${c.title ?? ""} ${c.email ?? ""} ${c.phone ?? ""} ${c.mobile ?? ""}`
                    .toLowerCase()
                    .includes(contactSearch.toLowerCase())
                ).length === 0 && (
                  <p className="text-sm text-muted-foreground">No contacts match your search.</p>
                )}
            </div>
          </div>
        )}

        {activeTab === "tickets" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <FilterPills value={ticketFilter} onChange={setTicketFilter} />
            </div>
            <PlaceholderPanel
              icon={Ticket}
              title="Tickets coming soon"
              description={`This will show ${ticketFilter === "ALL" ? "all" : ticketFilter.toLowerCase()} tickets for this client once the ticketing module (MegaTicket) is built.`}
            />
          </div>
        )}

        {activeTab === "opportunities" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <FilterPills value={oppFilter} onChange={setOppFilter} />
            </div>
            <PlaceholderPanel
              icon={Target}
              title="Opportunities coming soon"
              description={`This will show ${oppFilter === "ALL" ? "all" : oppFilter.toLowerCase()} opportunities for this client once the pipeline/opportunities system is built.`}
            />
          </div>
        )}

        {activeTab === "assets" && (
          <PlaceholderPanel
            icon={Package}
            title="Assets coming soon"
            description="Tracked and linked assets for this client will show here once the inventory system is built."
          />
        )}

        {activeTab === "contracts" && (
          <PlaceholderPanel
            icon={FileText}
            title="Contracts coming soon"
            description="Agreement contracts (MSP, VOIP, etc.) for this client will be managed here."
          />
        )}

        {activeTab === "licenses" && (
          <PlaceholderPanel
            icon={KeyRound}
            title="Licenses & Subscriptions coming soon"
            description="Will show one-time perpetual licenses and recurring subscriptions in two separate columns."
          />
        )}

        {activeTab === "documents" && (
          <PlaceholderPanel
            icon={FolderOpen}
            title="Documents coming soon"
            description="Files and documents related to this client will be stored and accessible here."
          />
        )}

        {activeTab === "engagement" && (
          <PlaceholderPanel
            icon={Radar}
            title="Engagement Hub coming soon"
            description="Client engagement and outreach tracking — this one still needs its own design pass before it's built."
          />
        )}
      </div>

      {viewingLocation && (
        <LocationDetailModal
          location={viewingLocation}
          contacts={client.contacts}
          onClose={() => setViewingLocation(null)}
          onSave={handleSaveLocation}
        />
      )}

      {viewingContact && (
        <ContactDetailModal
          contact={viewingContact}
          locations={client.locations}
          onClose={() => setViewingContact(null)}
          onSave={handleSaveContact}
        />
      )}
    </div>
  )
}

// ─── Location Detail Modal ──────────────────────────────────────────────
function LocationDetailModal({
  location,
  contacts,
  onClose,
  onSave,
}: {
  location: ClientLocation
  contacts: Contact[]
  onClose: () => void
  onSave: (locationId: string, data: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: location.name,
    address: location.address ?? "",
    address2: location.address2 ?? "",
    city: location.city ?? "",
    state: location.state ?? "",
    zip: location.zip ?? "",
    country: location.country ?? "",
    phone: location.phone ?? "",
    notes: location.notes ?? "",
    isPrimary: location.isPrimary,
    billingContactId: location.billingContactId ?? "",
    shippingContactId: location.shippingContactId ?? "",
  })

  return (
    <Modal maxWidth="md" onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{location.name}</h2>
        {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      {!editing ? (
        <div className="space-y-3 text-sm">
          <p><span className="font-medium text-foreground">Address:</span> <span className="text-muted-foreground">{locationAddress(location)}</span></p>
          <p><span className="font-medium text-foreground">Phone:</span> <span className="text-muted-foreground">{location.phone ?? "—"}</span></p>
          <p><span className="font-medium text-foreground">Billing Contact:</span> <span className="text-muted-foreground">{contactName(location.billingContact)}</span></p>
          <p><span className="font-medium text-foreground">Shipping Contact:</span> <span className="text-muted-foreground">{contactName(location.shippingContact)}</span></p>
          {location.notes && <p><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{location.notes}</span></p>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <input
            type="text"
            placeholder="Location Name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Address"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Suite, Apt, Unit (optional)"
            value={draft.address2}
            onChange={(e) => setDraft({ ...draft, address2: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="City"
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="State"
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="Zip"
              value={draft.zip}
              onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <input
            type="text"
            placeholder="Country"
            value={draft.country}
            onChange={(e) => setDraft({ ...draft, country: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            placeholder="Phone"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Billing Contact</label>
            <select
              value={draft.billingContactId}
              onChange={(e) => setDraft({ ...draft, billingContactId: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Shipping Contact</label>
            <select
              value={draft.shippingContactId}
              onChange={(e) => setDraft({ ...draft, shippingContactId: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.isPrimary}
              onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })}
              className="accent-primary"
            />
            Primary location
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={() => onSave(location.id, draft)}>Save</Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>Close</Button>
        )}
      </div>
    </Modal>
  )
}

// ─── Contact Detail Modal ───────────────────────────────────────────────
function ContactDetailModal({
  contact,
  locations,
  onClose,
  onSave,
}: {
  contact: Contact
  locations: ClientLocation[]
  onClose: () => void
  onSave: (contactId: string, data: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    mobile: contact.mobile ?? "",
    locationType: contact.locationType,
    locationId: contact.locationId ?? "",
    notes: contact.notes ?? "",
    isPrimary: contact.isPrimary,
  })

  const currentLocation = locations.find((l) => l.id === contact.locationId)

  return (
    <Modal maxWidth="md" onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{contact.firstName} {contact.lastName}</h2>
        {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      {!editing ? (
        <div className="space-y-3 text-sm">
          <p><span className="font-medium text-foreground">Title:</span> <span className="text-muted-foreground">{contact.title ?? "—"}</span></p>
          <p><span className="font-medium text-foreground">Email:</span> <span className="text-muted-foreground">{contact.email ?? "—"}</span></p>
          <p><span className="font-medium text-foreground">Work Phone:</span> <span className="text-muted-foreground">{contact.phone ?? "—"}</span></p>
          <p><span className="font-medium text-foreground">Cell Phone:</span> <span className="text-muted-foreground">{contact.mobile ?? "—"}</span></p>
          <p><span className="font-medium text-foreground">Type:</span> <span className="text-muted-foreground">{contact.locationType === "REMOTE" ? "Remote" : "In-Office"}</span></p>
          <p><span className="font-medium text-foreground">Location:</span> <span className="text-muted-foreground">{currentLocation?.name ?? "—"}</span></p>
          {contact.notes && <p><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{contact.notes}</span></p>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="First Name"
              value={draft.firstName}
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="Last Name"
              value={draft.lastName}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <input
            type="text"
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="email"
            placeholder="Email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Work Phone"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="text"
              placeholder="Cell Phone"
              value={draft.mobile}
              onChange={(e) => setDraft({ ...draft, mobile: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={draft.locationType}
              onChange={(e) => setDraft({ ...draft, locationType: e.target.value as "REMOTE" | "IN_OFFICE" })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="IN_OFFICE">In-Office</option>
              <option value="REMOTE">Remote</option>
            </select>
            <select
              value={draft.locationId}
              onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">No location</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.isPrimary}
              onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })}
              className="accent-primary"
            />
            Primary contact
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={() => onSave(contact.id, draft)}>Save</Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>Close</Button>
        )}
      </div>
    </Modal>
  )
}