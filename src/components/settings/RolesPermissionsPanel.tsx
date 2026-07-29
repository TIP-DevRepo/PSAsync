"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

interface RolePermissions {
  pages: { clients: boolean; catalog: boolean; vendors: boolean; quotes: boolean; settings: boolean }
  quotes: {
    create: boolean
    edit: boolean
    delete: boolean
    changeStatus: boolean
    approve: boolean
    sendEmail: boolean
    viewAllUsersQuotes: boolean
  }
  clients: { create: boolean; edit: boolean; delete: boolean; viewAllClients: boolean }
  settingsSections: {
    company: boolean
    users: boolean
    quotes: boolean
    approvalWorkflows: boolean
    notifications: boolean
    integrations: boolean
  }
}

interface Role {
  id: string
  name: string
  rank: number
  isSystem: boolean
  permissions: RolePermissions
}

const PAGE_LABELS: [keyof RolePermissions["pages"], string][] = [
  ["clients", "Clients"],
  ["catalog", "Catalog"],
  ["vendors", "Vendors"],
  ["quotes", "Quotes"],
  ["settings", "Settings (whole section)"],
]

const QUOTE_LABELS: [keyof RolePermissions["quotes"], string][] = [
  ["create", "Create quotes"],
  ["edit", "Edit quotes"],
  ["delete", "Delete quotes"],
  ["changeStatus", "Change quote status manually"],
  ["approve", "Approve pending-approval quotes"],
  ["sendEmail", "Send quotes via email"],
  ["viewAllUsersQuotes", "See all users' quotes (not just their own)"],
]

const CLIENT_LABELS: [keyof RolePermissions["clients"], string][] = [
  ["create", "Create clients"],
  ["edit", "Edit clients"],
  ["delete", "Delete clients"],
  ["viewAllClients", "View all clients (not just ones tied to their own quotes)"],
]

const SETTINGS_LABELS: [keyof RolePermissions["settingsSections"], string][] = [
  ["company", "Company Settings"],
  ["users", "Users & Roles"],
  ["quotes", "Quote Settings"],
  ["approvalWorkflows", "Approval Workflows"],
  ["notifications", "Notifications"],
  ["integrations", "Integrations"],
]

export function RolesPermissionsPanel() {
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [newRoleRank, setNewRoleRank] = useState("50")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState<Role | null>(null)

  function loadRoles(selectAfter?: string) {
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data: Role[]) => {
        setRoles(data)
        setLoading(false)
        if (selectAfter) setSelectedId(selectAfter)
      })
  }

  useEffect(() => {
    loadRoles()
  }, [])

  useEffect(() => {
    const role = roles.find((r) => r.id === selectedId) ?? null
    setDraft(role ? JSON.parse(JSON.stringify(role)) : null)
    setError("")
  }, [selectedId, roles])

  async function handleCreateRole() {
    if (!newRoleName.trim()) return
    setError("")
    setSaving(true)
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newRoleName.trim(), rank: Number(newRoleRank) || 0 }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      return
    }
    toast.success(`Role "${newRoleName.trim()}" created`)
    setNewRoleName("")
    setNewRoleRank("50")
    setShowNew(false)
    loadRoles(data.id)
  }

  async function handleSaveDraft() {
    if (!draft) return
    setError("")
    setSaving(true)
    const res = await fetch(`/api/roles/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, rank: draft.rank, permissions: draft.permissions }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      return
    }
    toast.success("Role updated")
    loadRoles(draft.id)
  }

  async function handleDelete(role: Role) {
    const confirmed = await confirmDialog({
      title: `Delete the "${role.name}" role?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setError("")
    const res = await fetch(`/api/roles/${role.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      return
    }
    toast.success(`Role "${role.name}" deleted`)
    setSelectedId(null)
    loadRoles()
  }

  function updatePagePerm(key: keyof RolePermissions["pages"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, pages: { ...draft.permissions.pages, [key]: value } } })
  }
  function updateQuotePerm(key: keyof RolePermissions["quotes"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, quotes: { ...draft.permissions.quotes, [key]: value } } })
  }
  function updateClientPerm(key: keyof RolePermissions["clients"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, clients: { ...draft.permissions.clients, [key]: value } } })
  }
  function updateSettingsPerm(key: keyof RolePermissions["settingsSections"], value: boolean) {
    if (!draft) return
    setDraft({
      ...draft,
      permissions: { ...draft.permissions, settingsSections: { ...draft.permissions.settingsSections, [key]: value } },
    })
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>

  return (
    <div className="flex gap-6 items-start">
      {/* Role list */}
      <div className="w-56 flex-shrink-0 space-y-2">
        {roles
          .slice()
          .sort((a, b) => b.rank - a.rank)
          .map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm text-left ${
                selectedId === r.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <span>{r.name}</span>
              <span className="text-xs opacity-60">rank {r.rank}</span>
            </button>
          ))}

        {showNew ? (
          <div className="rounded-md border p-3 space-y-2">
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Role name"
              className="w-full rounded-md border px-2 py-1.5 text-sm"
            />
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Rank (higher = more senior)</label>
              <input
                type="number"
                value={newRoleRank}
                onChange={(e) => setNewRoleRank(e.target.value)}
                className="w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateRole} disabled={saving || !newRoleName.trim()}>
                {saving ? "Creating..." : "Create"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setShowNew(true)}>
            + New Role
          </Button>
        )}
      </div>

      {/* Selected role editor */}
      <div className="flex-1 min-w-0">
        {!draft && (
          <p className="text-sm text-zinc-500">Select a role on the left, or create a new one.</p>
        )}

        {draft && (
          <div className="space-y-6">
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-end justify-between gap-4">
              <div className="flex gap-3 flex-1">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-500 mb-1">Role Name</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-xs text-zinc-500 mb-1">Rank</label>
                  <input
                    type="number"
                    value={draft.rank}
                    onChange={(e) => setDraft({ ...draft, rank: Number(e.target.value) })}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <Button variant="outline" onClick={() => handleDelete(draft)} className="text-red-600 hover:text-red-700">
                Delete Role
              </Button>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Page Access</h3>
              <div className="grid grid-cols-2 gap-2">
                {PAGE_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.permissions.pages[key]}
                      onChange={(e) => updatePagePerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Quote Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {QUOTE_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.permissions.quotes[key]}
                      onChange={(e) => updateQuotePerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Client Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {CLIENT_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.permissions.clients[key]}
                      onChange={(e) => updateClientPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Settings Sub-Access</h3>
              <div className="grid grid-cols-2 gap-2">
                {SETTINGS_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.permissions.settingsSections[key]}
                      onChange={(e) => updateSettingsPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <Button onClick={handleSaveDraft} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}