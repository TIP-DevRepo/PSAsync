"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { TabsBar } from "@/components/ui/tabs-bar"
import { Modal } from "@/components/Modal"
import { FileUploadZone } from "@/components/attachments/FileUploadZone"
import { RotateCcw, Upload, X } from "lucide-react"

interface VendorContact {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  locationId: string | null
  isPrimary: boolean
  notes: string | null
}

interface VendorLocation {
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
}

interface VendorDetail {
  id: string
  name: string
  type: string
  status: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  paymentTerms: string | null
  leadTimeDays: number | null
  notes: string | null
  isDistributor: boolean
  isVendor: boolean
  isManufacturer: boolean
  logoUrl: string | null
  locations: VendorLocation[]
  contacts: VendorContact[]
}

interface PurchaseOrderRow {
  id: string
  poNumber: string
  status: string
  total: number
  createdAt: string
}

interface VendorAttachmentType {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number | null
  createdAt: string
}

type VendorTabKey = "details" | "locations" | "contacts" | "rmas" | "purchaseOrders" | "documents"

const VENDOR_TABS: { key: VendorTabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "locations", label: "Locations" },
  { key: "contacts", label: "Contacts" },
  { key: "rmas", label: "RMAs" },
  { key: "purchaseOrders", label: "Purchase Orders" },
  { key: "documents", label: "Documents" },
]

const PO_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PARTS_ORDERED: "bg-info-bg text-info",
  RECEIVED: "bg-success-bg text-success",
  ON_HOLD: "bg-warning-bg text-warning",
  BACKORDERED: "bg-warning-bg text-warning",
  CANCELLED: "bg-danger-bg text-danger",
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

function fileSizeLabel(bytes: number | null) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function contactName(c: VendorContact | undefined | null) {
  return c ? `${c.firstName} ${c.lastName}` : "—"
}

function locationAddress(loc: VendorLocation | null) {
  if (!loc) return "—"
  const cityStateZip = [loc.city, loc.state, loc.zip].filter(Boolean).join(", ")
  return [loc.address, loc.address2, cityStateZip, loc.country].filter(Boolean).join(" · ") || loc.name
}

export default function VendorDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [vendor, setVendor] = useState<VendorDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<VendorTabKey>("details")

  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsDraft, setDetailsDraft] = useState({
    name: "",
    type: "",
    status: "",
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

  const [showAddLocation, setShowAddLocation] = useState(false)
  const [newLocation, setNewLocation] = useState({
    name: "", address: "", address2: "", city: "", state: "", zip: "", country: "", phone: "", notes: "", isPrimary: false,
  })
  const [viewingLocation, setViewingLocation] = useState<VendorLocation | null>(null)

  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({
    firstName: "", lastName: "", title: "", email: "", phone: "", mobile: "", locationId: "", notes: "", isPrimary: false,
  })
  const [viewingContact, setViewingContact] = useState<VendorContact | null>(null)

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([])
  const [attachments, setAttachments] = useState<VendorAttachmentType[]>([])
  const [uploadingLogo, setUploadingLogo] = useState(false)

  function loadVendor() {
    fetch(`/api/vendors/${id}`)
      .then((res) => res.json())
      .then((json) => {
        setVendor(json)
        setLoading(false)
      })
  }

  function loadAttachments() {
    fetch(`/api/vendors/${id}/attachments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setAttachments(data))
  }

  useEffect(() => {
    loadVendor()
    loadAttachments()
    fetch(`/api/vendors/${id}/purchase-orders`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setPurchaseOrders(data))
  }, [id])

  function startEditingDetails() {
    if (!vendor) return
    setDetailsDraft({
      name: vendor.name,
      type: vendor.type,
      status: vendor.status,
      email: vendor.email ?? "",
      phone: vendor.phone ?? "",
      website: vendor.website ?? "",
      address: vendor.address ?? "",
      paymentTerms: vendor.paymentTerms ?? "",
      leadTimeDays: vendor.leadTimeDays ? String(vendor.leadTimeDays) : "",
      notes: vendor.notes ?? "",
      isDistributor: vendor.isDistributor,
      isVendor: vendor.isVendor,
      isManufacturer: vendor.isManufacturer,
    })
    setEditingDetails(true)
  }

  async function handleSaveDetails() {
    const res = await fetch(`/api/vendors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(detailsDraft),
    })
    if (res.ok) {
      toast.success("Vendor details saved")
      setEditingDetails(false)
      loadVendor()
    } else {
      toast.error("Couldn't save vendor details")
    }
  }

  async function handleAddLocation() {
    const res = await fetch(`/api/vendors/${id}/locations`, {
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
    loadVendor()
  }

  async function handleSaveLocation(locationId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/vendors/${id}/locations/${locationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      toast.success("Location saved")
      setViewingLocation(null)
      loadVendor()
    } else {
      toast.error("Couldn't save location")
    }
  }

  async function handleAddContact() {
    const res = await fetch(`/api/vendors/${id}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newContact),
    })
    if (res.ok) {
      toast.success("Contact added")
    } else {
      toast.error("Couldn't add contact")
    }
    setNewContact({ firstName: "", lastName: "", title: "", email: "", phone: "", mobile: "", locationId: "", notes: "", isPrimary: false })
    setShowAddContact(false)
    loadVendor()
  }

  async function handleSaveContact(contactId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/vendors/${id}/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      toast.success("Contact saved")
      setViewingContact(null)
      loadVendor()
    } else {
      toast.error("Couldn't save contact")
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    await fetch(`/api/vendors/${id}/attachments/${attachmentId}`, { method: "DELETE" })
    toast.success("Attachment removed")
    loadAttachments()
  }

  async function handleLogoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingLogo(true)
    const formData = new FormData()
    formData.append("file", file)

    const res = await fetch(`/api/vendors/${id}/logo`, { method: "POST", body: formData })
    setUploadingLogo(false)

    if (res.ok) {
      toast.success("Logo uploaded")
      loadVendor()
    } else {
      toast.error("Couldn't upload logo")
    }
    e.target.value = ""
  }

  async function handleRemoveLogo() {
    await fetch(`/api/vendors/${id}/logo`, { method: "DELETE" })
    toast.success("Logo removed")
    loadVendor()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (!vendor) return <p className="text-sm text-danger">Vendor not found.</p>

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/dashboard/vendors" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-block mb-2">
          ← Back to Vendors
        </Link>
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            {vendor.logoUrl ? (
              <div className="relative h-16 w-16 rounded-lg border border-border overflow-hidden bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vendor.logoUrl} alt={`${vendor.name} logo`} className="h-full w-full object-contain" />
                <button
                  onClick={handleRemoveLogo}
                  title="Remove logo"
                  className="absolute -top-1 -right-1 rounded-full bg-danger text-white p-0.5 hover:opacity-90"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <label className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border bg-card/50 cursor-pointer hover:border-muted-foreground transition-colors">
                <input type="file" accept="image/*" onChange={handleLogoSelected} className="hidden" disabled={uploadingLogo} />
                <Upload size={18} className="text-muted-foreground" />
              </label>
            )}
          </div>
          <div>
            <h1 className="text-display font-semibold tracking-tight text-foreground">
              {vendor.name}
          {vendor.isDistributor && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary align-middle">Distributor</span>
          )}
          {vendor.isVendor && (
            <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info align-middle">Vendor</span>
          )}
          {vendor.isManufacturer && (
            <span className="ml-2 rounded-full bg-success-bg px-2 py-0.5 text-xs text-success align-middle">Manufacturer</span>
          )}
        </h1>
            <p className="text-sm text-muted-foreground">{vendor.type} · {vendor.status}</p>
          </div>
        </div>
      </div>

      <TabsBar tabs={VENDOR_TABS} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Vendor sections" />

      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "details" && (
          <div className="max-w-2xl space-y-4">
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
                  <p><span className="font-medium text-foreground">Type:</span> <span className="text-muted-foreground">{vendor.type}</span></p>
                  <p><span className="font-medium text-foreground">Status:</span> <span className="text-muted-foreground">{vendor.status}</span></p>
                  <p><span className="font-medium text-foreground">Email:</span> <span className="text-muted-foreground">{vendor.email ?? "—"}</span></p>
                  <p><span className="font-medium text-foreground">Phone:</span> <span className="text-muted-foreground">{vendor.phone ?? "—"}</span></p>
                  <p><span className="font-medium text-foreground">Website:</span> <span className="text-muted-foreground">{vendor.website ?? "—"}</span></p>
                  <p><span className="font-medium text-foreground">Address:</span> <span className="text-muted-foreground">{vendor.address ?? "—"}</span></p>
                  <p><span className="font-medium text-foreground">Payment Terms:</span> <span className="text-muted-foreground">{vendor.paymentTerms ?? "—"}</span></p>
                  <p><span className="font-medium text-foreground">Lead Time:</span> <span className="text-muted-foreground">{vendor.leadTimeDays ? `${vendor.leadTimeDays} days` : "—"}</span></p>
                  <p><span className="font-medium text-foreground">Tags:</span>{" "}
                    <span className="text-muted-foreground">
                      {[vendor.isVendor && "Vendor", vendor.isManufacturer && "Manufacturer", vendor.isDistributor && "Distributor"].filter(Boolean).join(", ") || "None"}
                    </span>
                  </p>
                  {vendor.notes && (
                    <p><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{vendor.notes}</span></p>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Vendor Name</label>
                    <input
                      type="text"
                      value={detailsDraft.name}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, name: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Type</label>
                      <select
                        value={detailsDraft.type}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, type: e.target.value })}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="SUPPLIER">Supplier</option>
                        <option value="SUBCONTRACTOR">Subcontractor</option>
                        <option value="PARTNER">Partner</option>
                        <option value="DISTRIBUTOR">Distributor</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Status</label>
                      <select
                        value={detailsDraft.status}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, status: e.target.value })}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                        <option value="PREFERRED">Preferred</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Address</label>
                    <input
                      type="text"
                      value={detailsDraft.address}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, address: e.target.value })}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Payment Terms</label>
                      <select
                        value={detailsDraft.paymentTerms}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, paymentTerms: e.target.value })}
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
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Lead Time (days)</label>
                      <input
                        type="number"
                        value={detailsDraft.leadTimeDays}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, leadTimeDays: e.target.value })}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Notes</label>
                    <textarea
                      value={detailsDraft.notes}
                      onChange={(e) => setDetailsDraft({ ...detailsDraft, notes: e.target.value })}
                      rows={2}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="flex flex-wrap gap-4 pt-2 border-t border-border">
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={detailsDraft.isVendor}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, isVendor: e.target.checked })}
                        className="accent-primary"
                      />
                      Vendor (I can buy from them)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={detailsDraft.isManufacturer}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, isManufacturer: e.target.checked })}
                        className="accent-primary"
                      />
                      Manufacturer (they make the item)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={detailsDraft.isDistributor}
                        onChange={(e) => setDetailsDraft({ ...detailsDraft, isDistributor: e.target.checked })}
                        className="accent-primary"
                      />
                      Distributor (has an API integration)
                    </label>
                  </div>
                </>
              )}
            </div>
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
                <input type="text" placeholder="Location Name" value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <input type="text" placeholder="Address" value={newLocation.address} onChange={(e) => setNewLocation({ ...newLocation, address: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <input type="text" placeholder="Suite, Apt, Unit (optional)" value={newLocation.address2} onChange={(e) => setNewLocation({ ...newLocation, address2: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <div className="grid grid-cols-3 gap-3">
                  <input type="text" placeholder="City" value={newLocation.city} onChange={(e) => setNewLocation({ ...newLocation, city: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <input type="text" placeholder="State" value={newLocation.state} onChange={(e) => setNewLocation({ ...newLocation, state: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <input type="text" placeholder="Zip" value={newLocation.zip} onChange={(e) => setNewLocation({ ...newLocation, zip: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <input type="text" placeholder="Country" value={newLocation.country} onChange={(e) => setNewLocation({ ...newLocation, country: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <input type="text" placeholder="Phone" value={newLocation.phone} onChange={(e) => setNewLocation({ ...newLocation, phone: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <textarea placeholder="Notes (optional)" value={newLocation.notes} onChange={(e) => setNewLocation({ ...newLocation, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={newLocation.isPrimary} onChange={(e) => setNewLocation({ ...newLocation, isPrimary: e.target.checked })} className="accent-primary" />
                  Set as primary location
                </label>
                <Button onClick={handleAddLocation}>Save Location</Button>
              </div>
            )}

            <div className="space-y-2">
              {vendor.locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => setViewingLocation(loc)}
                  className="w-full text-left rounded-lg border border-border bg-card shadow-card p-3 text-sm hover:bg-surface-hover transition-colors"
                >
                  <p className="font-medium text-foreground">
                    {loc.name}
                    {loc.isPrimary && <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info">Primary</span>}
                  </p>
                  <p className="text-muted-foreground">{locationAddress(loc)}</p>
                </button>
              ))}
              {vendor.locations.length === 0 && <p className="text-sm text-muted-foreground">No locations yet.</p>}
            </div>
          </div>
        )}

        {activeTab === "contacts" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setShowAddContact(!showAddContact)}>
                {showAddContact ? "Cancel" : "Add Contact"}
              </Button>
            </div>

            {showAddContact && (
              <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" placeholder="First Name" value={newContact.firstName} onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <input type="text" placeholder="Last Name" value={newContact.lastName} onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <input type="text" placeholder="Title" value={newContact.title} onChange={(e) => setNewContact({ ...newContact, title: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <input type="email" placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" placeholder="Work Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <input type="text" placeholder="Cell Phone" value={newContact.mobile} onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <select value={newContact.locationId} onChange={(e) => setNewContact({ ...newContact, locationId: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">No location</option>
                  {vendor.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
                <textarea placeholder="Notes (optional)" value={newContact.notes} onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={newContact.isPrimary} onChange={(e) => setNewContact({ ...newContact, isPrimary: e.target.checked })} className="accent-primary" />
                  Set as primary contact
                </label>
                <Button onClick={handleAddContact}>Save Contact</Button>
              </div>
            )}

            <div className="space-y-2">
              {vendor.contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => setViewingContact(contact)}
                  className="w-full text-left rounded-lg border border-border bg-card shadow-card p-3 text-sm hover:bg-surface-hover transition-colors"
                >
                  <p className="font-medium text-foreground">
                    {contact.firstName} {contact.lastName}
                    {contact.isPrimary && <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info">Primary</span>}
                  </p>
                  <p className="text-muted-foreground">{contact.title}</p>
                  <p className="text-muted-foreground">{contact.email} {contact.phone && `· ${contact.phone}`}</p>
                </button>
              ))}
              {vendor.contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
            </div>
          </div>
        )}

        {activeTab === "rmas" && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
            <RotateCcw className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-foreground">RMAs coming soon</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Return merchandise authorizations with this vendor will be tracked here once the RMA system is built.
            </p>
          </div>
        )}

        {activeTab === "purchaseOrders" && (
          <div className="rounded-lg border border-border bg-card shadow-card overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-caption text-muted-foreground">
                  <th className="py-2 pl-4 pr-3">PO Number</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="border-b border-border last:border-0">
                    <td className="py-2 pl-4 pr-3">
                      <Link href={`/dashboard/purchase-orders/${po.id}`} className="text-primary hover:underline font-medium">
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${PO_STATUS_COLORS[po.status]}`}>
                        {statusLabel(po.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right text-foreground tabular-nums">{money(po.total)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{new Date(po.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {purchaseOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      No Purchase Orders sent to this vendor yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "documents" && (
          <div className="rounded-lg border border-border bg-card shadow-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold text-sm text-foreground">Documents</h2>
            <FileUploadZone uploadUrl={`/api/vendors/${id}/attachments`} onUploaded={loadAttachments} />
            <div className="space-y-2">
              {attachments.length === 0 && <p className="text-sm text-muted-foreground">No files attached yet.</p>}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {a.fileName}
                  </a>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{fileSizeLabel(a.fileSize)}</span>
                    <button onClick={() => handleDeleteAttachment(a.id)} className="text-xs text-danger hover:underline">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {viewingLocation && (
        <VendorLocationModal
          location={viewingLocation}
          onClose={() => setViewingLocation(null)}
          onSave={handleSaveLocation}
        />
      )}

      {viewingContact && (
        <VendorContactModal
          contact={viewingContact}
          locations={vendor.locations}
          onClose={() => setViewingContact(null)}
          onSave={handleSaveContact}
        />
      )}
    </div>
  )
}

// ─── Location Detail Modal ──────────────────────────────────────────────
function VendorLocationModal({
  location,
  onClose,
  onSave,
}: {
  location: VendorLocation
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
          {location.notes && <p><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{location.notes}</span></p>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <input type="text" placeholder="Location Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <input type="text" placeholder="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <input type="text" placeholder="Suite, Apt, Unit" value={draft.address2} onChange={(e) => setDraft({ ...draft, address2: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="grid grid-cols-3 gap-2">
            <input type="text" placeholder="City" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <input type="text" placeholder="State" value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <input type="text" placeholder="Zip" value={draft.zip} onChange={(e) => setDraft({ ...draft, zip: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <input type="text" placeholder="Country" value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <input type="text" placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <textarea placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={draft.isPrimary} onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })} className="accent-primary" />
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
function VendorContactModal({
  contact,
  locations,
  onClose,
  onSave,
}: {
  contact: VendorContact
  locations: VendorLocation[]
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
          <p><span className="font-medium text-foreground">Location:</span> <span className="text-muted-foreground">{currentLocation?.name ?? "—"}</span></p>
          {contact.notes && <p><span className="font-medium text-foreground">Notes:</span> <span className="text-muted-foreground">{contact.notes}</span></p>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input type="text" placeholder="First Name" value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <input type="text" placeholder="Last Name" value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <input type="text" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <input type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="grid grid-cols-2 gap-2">
            <input type="text" placeholder="Work Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <input type="text" placeholder="Cell Phone" value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <select value={draft.locationId} onChange={(e) => setDraft({ ...draft, locationId: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">No location</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
          <textarea placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={draft.isPrimary} onChange={(e) => setDraft({ ...draft, isPrimary: e.target.checked })} className="accent-primary" />
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