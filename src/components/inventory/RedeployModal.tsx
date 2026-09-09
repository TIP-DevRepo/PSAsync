"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"

interface ContactOption { id: string; firstName: string; lastName: string }
interface UserOption { id: string; name: string }

export function RedeployModal({
  assetId,
  status,
  clientId,
  currentLoanExpectedReturnDate,
  onClose,
  onDone,
}: {
  assetId: string
  status: string
  // The owning client (Sold + deployed) or loaned-to client (Loaned) whose
  // contacts we're picking from. Not needed for Internal, which picks a
  // company user instead.
  clientId?: string
  currentLoanExpectedReturnDate?: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contactId, setContactId] = useState("")
  const [loanReturnDate, setLoanReturnDate] = useState(
    currentLoanExpectedReturnDate ? currentLoanExpectedReturnDate.slice(0, 10) : ""
  )

  const [users, setUsers] = useState<UserOption[]>([])
  const [userId, setUserId] = useState("")

  useEffect(() => {
    if (status === "INTERNAL") {
      fetch("/api/users").then((res) => res.json()).then((data) => Array.isArray(data) && setUsers(data))
      return
    }
    if (clientId) {
      fetch(`/api/clients/${clientId}`)
        .then((res) => res.json())
        .then((client) => setContacts(client.contacts ?? []))
    }
  }, [status, clientId])

  async function handleSubmit() {
    setError(null)

    let body: Record<string, unknown>
    if (status === "INTERNAL") {
      if (!userId) { setError("Select a user"); return }
      body = { userId }
    } else {
      if (!contactId) { setError("Select a contact"); return }
      body = status === "LOANED" && loanReturnDate ? { contactId, loanExpectedReturnDate: loanReturnDate } : { contactId }
    }

    setSaving(true)
    const res = await fetch(`/api/inventory-assets/${assetId}/redeploy`, {
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
      setError(data.error ?? "Couldn't redeploy asset")
    }
  }

  return (
    <Modal maxWidth="sm" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Re-deploy Asset</h2>
      <p className="mt-1 text-sm text-muted-foreground">Change who currently has this asset.</p>

      <div className="mt-4 space-y-3">
        {status === "INTERNAL" ? (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">User</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select a user</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Contact</label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select a contact</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
            {status === "LOANED" && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Expected Return Date</label>
                <input
                  type="date"
                  value={loanReturnDate}
                  onChange={(e) => setLoanReturnDate(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
          </>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Re-deploy"}</Button>
      </div>
    </Modal>
  )
}
