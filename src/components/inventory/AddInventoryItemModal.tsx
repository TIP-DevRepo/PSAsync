"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { buildLocationPathOptions, type LocationPathOption } from "@/lib/inventory/locationPaths"
import { plainStatusLabel } from "@/lib/inventory/statusLabel"
import { CatalogItemPicker, type CatalogItemOption } from "@/components/inventory/CatalogItemPicker"
import { AssetAdditionalDetailsFields, additionalDetailsToBody, EMPTY_ADDITIONAL_DETAILS, type AdditionalDetailsValue } from "@/components/inventory/AssetAdditionalDetailsFields"

interface ClientOption {
  id: string
  name: string
  isInternal: boolean
}
interface ClientLocationOption {
  id: string
  name: string
}
interface ContactOption {
  id: string
  firstName: string
  lastName: string
  locationId: string | null
}
interface UserOption {
  id: string
  name: string
}

type ItemKind = "ASSET" | "STOCK"

const ASSET_STATUSES = ["IN_STOCK", "INTERNAL", "LOANED", "SOLD", "PENDING_OFFBOARD", "REMOVED"] as const

const REMOVED_REASONS = [
  { value: "BROKEN_SCRAPPED", label: "Broken / Scrapped" },
  { value: "LOST", label: "Lost" },
  { value: "DONATED", label: "Donated" },
  { value: "RETURNED_TO_VENDOR", label: "Returned to Vendor" },
  { value: "OTHER", label: "Other" },
]

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function AddInventoryItemModal({
  initialClientId,
  onClose,
  onDone,
}: {
  initialClientId?: string
  onClose: () => void
  onDone: () => void
}) {
  const [kind, setKind] = useState<ItemKind>("ASSET")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientId, setClientId] = useState(initialClientId ?? "")

  const [clientInventoryOnboarded, setClientInventoryOnboarded] = useState(false)
  const [ownerContacts, setOwnerContacts] = useState<ContactOption[]>([])
  const [sites, setSites] = useState<ClientLocationOption[]>([])
  const [siteId, setSiteId] = useState("")

  const [containers, setContainers] = useState<LocationPathOption[]>([])
  const [containerId, setContainerId] = useState("")

  // Container is a hard schema requirement for Pooled Stock (InventoryStock
  // has no "just at the site" fallback), but for a Serialized Asset it's
  // only meaningful once the client has actually been onboarded for
  // Inventory AND the chosen site has containers built under it — otherwise
  // there's nothing sensible to pick from, so it stays optional and the
  // asset just tracks at the site level (mirrors PO receiving's own
  // client-owned-but-no-container fallback).
  const containerRequired = kind === "STOCK" || (clientInventoryOnboarded && containers.length > 0)

  const [catalogItem, setCatalogItem] = useState<CatalogItemOption | null>(null)
  const [serialNumber, setSerialNumber] = useState("")
  const [status, setStatus] = useState<string>("IN_STOCK")
  const [quantity, setQuantity] = useState("")

  // SOLD only — stays in a container by default (locationId), or can be
  // deployed straight to one of the Owner client's contacts instead,
  // exactly like the existing Check Out modal's Sold flow.
  const [deployToContact, setDeployToContact] = useState(false)
  const [deployContactId, setDeployContactId] = useState("")

  // LOANED only — ownership stays with the company, this client/contact
  // is who it's currently out with, not who owns it.
  const [loanedToClientId, setLoanedToClientId] = useState("")
  const [loanedContacts, setLoanedContacts] = useState<ContactOption[]>([])
  const [loanedToContactId, setLoanedToContactId] = useState("")
  const [loanExpectedReturnDate, setLoanExpectedReturnDate] = useState("")

  // INTERNAL only.
  const [users, setUsers] = useState<UserOption[]>([])
  const [assignedUserId, setAssignedUserId] = useState("")

  // REMOVED only.
  const [removedReason, setRemovedReason] = useState("")

  // Always available on a Serialized Asset, regardless of status.
  const [details, setDetails] = useState<AdditionalDetailsValue>(EMPTY_ADDITIONAL_DETAILS)

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data: ClientOption[]) => Array.isArray(data) && setClients(data))
    fetch("/api/users")
      .then((res) => res.json())
      .then((data: UserOption[]) => Array.isArray(data) && setUsers(data))
  }, [])

  useEffect(() => {
    setSiteId("")
    setSites([])
    setContainerId("")
    setContainers([])
    setClientInventoryOnboarded(false)
    setOwnerContacts([])
    if (!clientId) return
    fetch(`/api/clients/${clientId}`)
      .then((res) => res.json())
      .then((client) => {
        setSites(client.locations ?? [])
        setClientInventoryOnboarded(!!client.inventoryOnboarded)
        setOwnerContacts(client.contacts ?? [])
      })
  }, [clientId])

  useEffect(() => {
    setContainerId("")
    setContainers([])
    if (!siteId) return
    fetch(`/api/inventory-locations?clientLocationId=${siteId}`)
      .then((res) => res.json())
      .then((data) => setContainers(buildLocationPathOptions(data.locations ?? [])))
  }, [siteId])

  useEffect(() => {
    setLoanedToContactId("")
    setLoanedContacts([])
    if (!loanedToClientId) return
    fetch(`/api/clients/${loanedToClientId}`)
      .then((res) => res.json())
      .then((client) => setLoanedContacts(client.contacts ?? []))
  }, [loanedToClientId])

  function handleKindChange(next: ItemKind) {
    setKind(next)
    setCatalogItem(null)
    setSerialNumber("")
    setQuantity("")
    setStatus("IN_STOCK")
    setDetails(EMPTY_ADDITIONAL_DETAILS)
    setError(null)
  }

  function handleStatusChange(next: string) {
    setStatus(next)
    setDeployToContact(false)
    setDeployContactId("")
    setLoanedToClientId("")
    setLoanedToContactId("")
    setLoanExpectedReturnDate("")
    setAssignedUserId("")
    setRemovedReason("")
    setError(null)
  }

  async function handleSubmit() {
    setError(null)

    if (!catalogItem) { setError("Select a Catalog Item"); return }

    let body: Record<string, unknown>

    if (kind === "ASSET") {
      if (!serialNumber.trim()) { setError("Serial number is required"); return }

      const extra = additionalDetailsToBody(details)

      if (status === "LOANED") {
        if (!loanedToClientId) { setError("Select who this is loaned to"); return }
        if (!loanedToContactId) { setError("Select a contact"); return }
        if (!loanExpectedReturnDate) { setError("Expected return date is required"); return }
        body = {
          catalogItemId: catalogItem.id,
          serialNumber: serialNumber.trim(),
          status,
          loanedToClientId,
          loanedToContactId,
          loanExpectedReturnDate,
          ...extra,
        }
      } else if (status === "INTERNAL") {
        if (!assignedUserId) { setError("Select a user"); return }
        body = {
          catalogItemId: catalogItem.id,
          serialNumber: serialNumber.trim(),
          status,
          assignedUserId,
          ...extra,
        }
      } else {
        if (!clientId) { setError("Select a client"); return }

        if (status === "SOLD" && deployToContact) {
          if (!deployContactId) { setError("Select a contact"); return }
          body = {
            catalogItemId: catalogItem.id,
            serialNumber: serialNumber.trim(),
            status,
            clientId,
            deployedToContactId: deployContactId,
            ...extra,
          }
        } else {
          if (!siteId) { setError("Select a location"); return }
          if (containerRequired && !containerId) { setError("Select a container"); return }
          if (status === "REMOVED" && !removedReason) { setError("Select a removed reason"); return }
          body = {
            catalogItemId: catalogItem.id,
            serialNumber: serialNumber.trim(),
            status,
            clientId,
            clientLocationId: siteId,
            locationId: containerId || null,
            ...(status === "REMOVED" ? { removedReason } : {}),
            ...extra,
          }
        }
      }
    } else {
      if (!clientId) { setError("Select a client"); return }
      if (!siteId) { setError("Select a location"); return }
      if (containerRequired && !containerId) { setError("Select a container"); return }
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty <= 0) { setError("Enter a valid quantity"); return }
      body = {
        catalogItemId: catalogItem.id,
        clientLocationId: siteId,
        locationId: containerId,
        quantity: qty,
      }
    }

    setSaving(true)
    const res = await fetch(kind === "ASSET" ? "/api/inventory-assets" : "/api/inventory-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSaving(false)

    if (res.ok) {
      onDone()
      onClose()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't add this item")
    }
  }

  const showOwnerAndLocation = kind === "STOCK" || (status !== "LOANED" && status !== "INTERNAL")
  const showDeployToContactToggle = kind === "ASSET" && status === "SOLD"
  const usingContactInsteadOfContainer = showDeployToContactToggle && deployToContact

  return (
    <Modal maxWidth="lg" scrollable onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Add Inventory Item</h2>

      <div className="mt-4 flex gap-2">
        {(["ASSET", "STOCK"] as ItemKind[]).map((k) => (
          <button
            key={k}
            onClick={() => handleKindChange(k)}
            className={`rounded-full px-3 py-1 text-sm border transition-colors ${
              kind === k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-surface-hover"
            }`}
          >
            {k === "ASSET" ? "Serialized Asset" : "Pooled Stock"}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <CatalogItemPicker isSerialized={kind === "ASSET"} value={catalogItem} onChange={setCatalogItem} />

        {kind === "ASSET" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Serial Number *</label>
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className={SELECT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Status</label>
              <select value={status} onChange={(e) => handleStatusChange(e.target.value)} className={SELECT_CLASS}>
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>{plainStatusLabel(s)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {kind === "ASSET" && status === "LOANED" && (
          <div className="rounded-md border border-border bg-card p-3 space-y-3">
            <p className="text-sm font-medium text-foreground">Loaned To</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Client *</label>
                <select value={loanedToClientId} onChange={(e) => setLoanedToClientId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">Select a client</option>
                  {clients.filter((c) => !c.isInternal).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Contact *</label>
                <select value={loanedToContactId} onChange={(e) => setLoanedToContactId(e.target.value)} disabled={!loanedToClientId} className={`${SELECT_CLASS} disabled:opacity-50`}>
                  <option value="">Select a contact</option>
                  {loanedContacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expected Return Date *</label>
              <input type="date" value={loanExpectedReturnDate} onChange={(e) => setLoanExpectedReturnDate(e.target.value)} className={SELECT_CLASS} />
            </div>
          </div>
        )}

        {kind === "ASSET" && status === "INTERNAL" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Assigned User *</label>
            <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className={SELECT_CLASS}>
              <option value="">Select a user</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}

        {showOwnerAndLocation && (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Client / Ownership</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={SELECT_CLASS}>
                <option value="">Select a client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isInternal ? " (Internal)" : ""}</option>
                ))}
              </select>
            </div>

            {showDeployToContactToggle && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={deployToContact} onChange={(e) => setDeployToContact(e.target.checked)} className="accent-primary" />
                Deploy directly to a contact instead of stocking in a container
              </label>
            )}

            {usingContactInsteadOfContainer ? (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Contact *</label>
                <select value={deployContactId} onChange={(e) => setDeployContactId(e.target.value)} disabled={!clientId} className={`${SELECT_CLASS} disabled:opacity-50`}>
                  <option value="">Select a contact</option>
                  {ownerContacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Location</label>
                    <select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!clientId} className={`${SELECT_CLASS} disabled:opacity-50`}>
                      <option value="">Select a location</option>
                      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Container{containerRequired ? " *" : ""}</label>
                    <select
                      value={containerId}
                      onChange={(e) => setContainerId(e.target.value)}
                      disabled={!siteId || !clientInventoryOnboarded}
                      className={`${SELECT_CLASS} disabled:opacity-50`}
                    >
                      <option value="">{containerRequired ? "Select a container" : "None (track at location level)"}</option>
                      {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                </div>

                {siteId && !clientInventoryOnboarded && (
                  <p className={`text-xs ${kind === "STOCK" ? "text-danger" : "text-muted-foreground"}`}>
                    {kind === "STOCK"
                      ? "This client isn't onboarded for Inventory management yet, so there's no container to place Pooled Stock in here. Onboard it for Inventory first."
                      : "This client isn't onboarded for Inventory management yet, so Container selection is disabled — the asset will just be tracked at the location level."}
                  </p>
                )}

                {siteId && clientInventoryOnboarded && containers.length === 0 && (
                  <p className={`text-xs ${kind === "STOCK" ? "text-danger" : "text-muted-foreground"}`}>
                    {kind === "STOCK"
                      ? "This location has no containers set up yet. Pooled Stock always needs one — set one up under this client's Locations first."
                      : "This location has no containers set up yet, so the asset will just be tracked at the location level."}
                  </p>
                )}
              </>
            )}

            {kind === "ASSET" && status === "REMOVED" && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Removed Reason *</label>
                <select value={removedReason} onChange={(e) => setRemovedReason(e.target.value)} className={SELECT_CLASS}>
                  <option value="">Select a reason</option>
                  {REMOVED_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {kind === "STOCK" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Quantity *</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={SELECT_CLASS}
            />
          </div>
        )}

        {kind === "ASSET" && (
          <AssetAdditionalDetailsFields value={details} onChange={setDetails} categoryId={catalogItem?.categoryId ?? null} />
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? "Adding..." : kind === "ASSET" ? "Add Asset" : "Add Stock"}
        </Button>
      </div>
    </Modal>
  )
}
