"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import type { LocationPathOption } from "@/lib/inventory/locationPaths"

interface ClientOption { id: string; name: string }
interface ContactOption { id: string; firstName: string; lastName: string; locationId: string | null }
interface UserOption { id: string; name: string }

type CheckoutType = "SOLD" | "LOANED" | "INTERNAL"

export function CheckoutModal({
  assetId,
  deployFromClientId,
  onClose,
  onDone,
}: {
  assetId: string
  // When set, this asset is already client-owned stock sitting in a
  // Container — "checking out" here just means deploying it to one of
  // that same client's contacts, so the Sold/Loaned/Internal picker and
  // client dropdown are skipped entirely.
  deployFromClientId?: string
  onClose: () => void
  onDone: () => void
}) {
  const [type, setType] = useState<CheckoutType>("SOLD")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clients, setClients] = useState<ClientOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [companyContainers, setCompanyContainers] = useState<LocationPathOption[]>([])

  const [clientId, setClientId] = useState("")
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [clientContainers, setClientContainers] = useState<LocationPathOption[]>([])

  const [soldMode, setSoldMode] = useState<"container" | "contact">("container")
  const [containerId, setContainerId] = useState("")
  const [contactId, setContactId] = useState("")
  const [loanReturnDate, setLoanReturnDate] = useState("")
  const [userId, setUserId] = useState("")

  useEffect(() => {
    if (deployFromClientId) {
      fetch(`/api/clients/${deployFromClientId}`)
        .then((res) => res.json())
        .then((client) => setContacts(client.contacts ?? []))
      return
    }
    fetch("/api/clients").then((res) => res.json()).then((data) => Array.isArray(data) && setClients(data))
    fetch("/api/users").then((res) => res.json()).then((data) => Array.isArray(data) && setUsers(data))
    fetch("/api/inventory-locations/own-company").then((res) => res.json()).then((data) => Array.isArray(data) && setCompanyContainers(data))
  }, [deployFromClientId])

  useEffect(() => {
    if (deployFromClientId) return
    setContactId("")
    setContainerId("")
    setContacts([])
    setClientContainers([])
    if (!clientId) return
    fetch(`/api/clients/${clientId}`)
      .then((res) => res.json())
      .then((client) => {
        setContacts(client.contacts ?? [])
      })
  }, [clientId, deployFromClientId])

  // For deploying to a Contact, we still need Containers at whichever
  // site that contact is based, purely to resolve the site if the
  // contact has no location set — not shown as a picker in that case.
  useEffect(() => {
    if (type !== "SOLD" || soldMode !== "container" || !clientId) return
    // Sold-as-stocked keeps it in OUR warehouse, not the client's — this
    // branch is intentionally left using companyContainers, no client
    // container fetch needed here.
  }, [type, soldMode, clientId])

  async function handleSubmit() {
    setError(null)
    setSaving(true)

    if (deployFromClientId) {
      if (!contactId) { setError("Select a contact"); setSaving(false); return }
      const res = await fetch(`/api/inventory-assets/${assetId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      })
      setSaving(false)
      if (res.ok) {
        onDone()
        onClose()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Couldn't complete checkout")
      }
      return
    }

    let body: Record<string, unknown> = { type }
    if (type === "SOLD") {
      if (!clientId) { setError("Select a client"); setSaving(false); return }
      if (soldMode === "container") {
        if (!containerId) { setError("Select a container"); setSaving(false); return }
        body = { ...body, clientId, containerId }
      } else {
        if (!contactId) { setError("Select a contact"); setSaving(false); return }
        body = { ...body, clientId, contactId }
      }
    } else if (type === "LOANED") {
      if (!clientId || !contactId || !loanReturnDate) {
        setError("Client, contact, and expected return date are required")
        setSaving(false)
        return
      }
      body = { ...body, clientId, contactId, loanExpectedReturnDate: loanReturnDate }
    } else {
      if (!userId) { setError("Select a user"); setSaving(false); return }
      body = { ...body, userId }
    }

    const res = await fetch(`/api/inventory-assets/${assetId}/checkout`, {
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
      setError(data.error ?? "Couldn't complete checkout")
    }
  }

  if (deployFromClientId) {
    return (
      <Modal maxWidth="sm" onClose={onClose}>
        <h2 className="text-lg font-bold text-foreground">Check Out Asset</h2>
        <p className="mt-1 text-sm text-muted-foreground">Already sold to this client — pick who it's going to.</p>

        <div className="mt-4">
          <label className="block text-xs text-muted-foreground mb-1">Contact</label>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">Select a contact</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
          </select>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? "Checking Out..." : "Check Out"}</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal maxWidth="md" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Check Out Asset</h2>

      <div className="mt-4 flex gap-2">
        {(["SOLD", "LOANED", "INTERNAL"] as CheckoutType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-full px-3 py-1 text-sm border transition-colors ${
              type === t ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:bg-surface-hover"
            }`}
          >
            {t === "SOLD" ? "Sold" : t === "LOANED" ? "Loaned" : "Internal"}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {type === "SOLD" && (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">Select a client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {clientId && (
              <>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input type="radio" checked={soldMode === "container"} onChange={() => setSoldMode("container")} className="accent-primary" />
                    Stock it (our warehouse)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input type="radio" checked={soldMode === "contact"} onChange={() => setSoldMode("contact")} className="accent-primary" />
                    Deploy to a contact
                  </label>
                </div>

                {soldMode === "container" ? (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Container</label>
                    <select value={containerId} onChange={(e) => setContainerId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">Select a container</option>
                      {companyContainers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Contact</label>
                    <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">Select a contact</option>
                      {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {type === "LOANED" && (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">Select a client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {clientId && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Contact</label>
                <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">Select a contact</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expected Return Date</label>
              <input type="date" value={loanReturnDate} onChange={(e) => setLoanReturnDate(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
          </>
        )}

        {type === "INTERNAL" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">User</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">Select a user</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Check Out"}</Button>
      </div>
    </Modal>
  )
}