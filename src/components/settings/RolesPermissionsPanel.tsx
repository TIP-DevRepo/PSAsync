"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { GLOBAL_ADMIN_RANK } from "@/lib/global-admin-role"

interface RolePermissions {
  pages: {
    clients: boolean
    catalog: boolean
    vendors: boolean
    inventory: boolean
    quotes: boolean
    settings: boolean
    salesOrders: boolean
    purchaseOrders: boolean
  }
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
  salesOrders: { create: boolean; edit: boolean; delete: boolean; changeStatus: boolean; generatePO: boolean; viewAll: boolean }
  purchaseOrders: { create: boolean; edit: boolean; delete: boolean; changeStatus: boolean; send: boolean; viewAll: boolean }
  catalog: { delete: boolean }
  inventory: { delete: boolean }
  settingsSections: {
    company: boolean
    users: boolean
    quotes: boolean
    approvalWorkflows: boolean
    notifications: boolean
    integrations: boolean
  }
  dashboards: { manage: boolean }
}

interface Role {
  id: string
  name: string
  rank: number
  isSystem: boolean
  isGlobalAdmin: boolean
  permissions: RolePermissions
}

const PAGE_LABELS: [keyof RolePermissions["pages"], string][] = [
  ["clients", "Clients"],
  ["catalog", "Catalog"],
  ["vendors", "Vendors"],
  ["inventory", "Inventory"],
  ["quotes", "Quotes"],
  ["salesOrders", "Sales Orders"],
  ["purchaseOrders", "Purchase Orders"],
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

const SALES_ORDER_LABELS: [keyof RolePermissions["salesOrders"], string][] = [
  ["create", "Create sales orders"],
  ["edit", "Edit sales orders"],
  ["delete", "Delete sales orders"],
  ["changeStatus", "Change sales order status manually"],
  ["generatePO", "Generate purchase orders from a sales order"],
  ["viewAll", "See all users' sales orders (not just their own)"],
]

const PURCHASE_ORDER_LABELS: [keyof RolePermissions["purchaseOrders"], string][] = [
  ["create", "Create purchase orders"],
  ["edit", "Edit purchase orders"],
  ["delete", "Delete purchase orders"],
  ["changeStatus", "Change purchase order status manually"],
  ["send", "Send purchase orders to vendors"],
  ["viewAll", "See all users' purchase orders (not just their own)"],
]

const CATALOG_LABELS: [keyof RolePermissions["catalog"], string][] = [
  ["delete", "Delete catalog items"],
]

const INVENTORY_LABELS: [keyof RolePermissions["inventory"], string][] = [
  ["delete", "Delete inventory assets and stock"],
]

const SETTINGS_LABELS: [keyof RolePermissions["settingsSections"], string][] = [
  ["company", "Company Settings"],
  ["users", "Users & Roles"],
  ["quotes", "Quote Settings"],
  ["approvalWorkflows", "Approval Workflows"],
  ["notifications", "Notifications"],
  ["integrations", "Integrations"],
]

const DASHBOARD_LABELS: [keyof RolePermissions["dashboards"], string][] = [
  ["manage", "Edit the company's Default dashboard"],
]

export function RolesPermissionsPanel() {
  const [roles, setRoles] = useState<Role[]>([])
  const [myRank, setMyRank] = useState(0)
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
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((session) => {
        const role = session?.user?.role
        setMyRank(role?.isGlobalAdmin ? Number.MAX_SAFE_INTEGER : role?.rank ?? 0)
      })
  }, [])

  // Ranked at or above your own. The API rejects edits/deletes to these
  // regardless, this just keeps the UI from suggesting you can.
  const isRankLocked = (role: Role) => role.rank >= myRank

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
  function updateSalesOrderPerm(key: keyof RolePermissions["salesOrders"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, salesOrders: { ...draft.permissions.salesOrders, [key]: value } } })
  }
  function updatePurchaseOrderPerm(key: keyof RolePermissions["purchaseOrders"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, purchaseOrders: { ...draft.permissions.purchaseOrders, [key]: value } } })
  }
  function updateCatalogPerm(key: keyof RolePermissions["catalog"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, catalog: { ...draft.permissions.catalog, [key]: value } } })
  }
  function updateInventoryPerm(key: keyof RolePermissions["inventory"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, inventory: { ...draft.permissions.inventory, [key]: value } } })
  }
  function updateSettingsPerm(key: keyof RolePermissions["settingsSections"], value: boolean) {
    if (!draft) return
    setDraft({
      ...draft,
      permissions: { ...draft.permissions, settingsSections: { ...draft.permissions.settingsSections, [key]: value } },
    })
  }
  function updateDashboardsPerm(key: keyof RolePermissions["dashboards"], value: boolean) {
    if (!draft) return
    setDraft({ ...draft, permissions: { ...draft.permissions, dashboards: { ...draft.permissions.dashboards, [key]: value } } })
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
              <span className="text-xs opacity-60">{r.isGlobalAdmin ? "locked" : `rank ${r.rank}`}</span>
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
                max={GLOBAL_ADMIN_RANK - 1}
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

        {draft && (() => {
          const rankLocked = !draft.isGlobalAdmin && isRankLocked(draft)
          const isLocked = draft.isGlobalAdmin || rankLocked
          return (
          <div className="space-y-6">
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {draft.isGlobalAdmin && (
              <div className="rounded-md border border-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-600 dark:text-zinc-400">
                The Global Admin role always has access to everything and cannot be edited or deleted.
              </div>
            )}

            {rankLocked && (
              <div className="rounded-md border border-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-600 dark:text-zinc-400">
                This role is ranked at or above your own. You can only edit roles below you in the hierarchy.
              </div>
            )}

            <div className="flex items-end justify-between gap-4">
              <div className="flex gap-3 flex-1">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-500 mb-1">Role Name</label>
                  <input
                    type="text"
                    value={draft.name}
                    disabled={isLocked}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-xs text-zinc-500 mb-1">Rank</label>
                  <input
                    type="number"
                    value={draft.rank}
                    max={GLOBAL_ADMIN_RANK - 1}
                    disabled={isLocked}
                    onChange={(e) => setDraft({ ...draft, rank: Number(e.target.value) })}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
              </div>
              {!isLocked && (
                <Button variant="outline" onClick={() => handleDelete(draft)} className="text-red-600 hover:text-red-700">
                  Delete Role
                </Button>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Page Access</h3>
              <div className="grid grid-cols-2 gap-2">
                {PAGE_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isGlobalAdmin ? true : draft.permissions.pages[key] ?? false}
                      disabled={isLocked}
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
                      checked={draft.isGlobalAdmin ? true : draft.permissions.quotes[key]}
                      disabled={isLocked}
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
                      checked={draft.isGlobalAdmin ? true : draft.permissions.clients[key]}
                      disabled={isLocked}
                      onChange={(e) => updateClientPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Sales Order Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {SALES_ORDER_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isGlobalAdmin ? true : draft.permissions.salesOrders?.[key] ?? false}
                      disabled={isLocked}
                      onChange={(e) => updateSalesOrderPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Purchase Order Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {PURCHASE_ORDER_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isGlobalAdmin ? true : draft.permissions.purchaseOrders?.[key] ?? false}
                      disabled={isLocked}
                      onChange={(e) => updatePurchaseOrderPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Catalog Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {CATALOG_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isGlobalAdmin ? true : draft.permissions.catalog?.[key] ?? false}
                      disabled={isLocked}
                      onChange={(e) => updateCatalogPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Inventory Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {INVENTORY_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isGlobalAdmin ? true : draft.permissions.inventory?.[key] ?? false}
                      disabled={isLocked}
                      onChange={(e) => updateInventoryPerm(key, e.target.checked)}
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
                      checked={draft.isGlobalAdmin ? true : draft.permissions.settingsSections[key]}
                      disabled={isLocked}
                      onChange={(e) => updateSettingsPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Dashboard Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {DASHBOARD_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.isGlobalAdmin ? true : draft.permissions.dashboards?.[key] ?? false}
                      disabled={isLocked}
                      onChange={(e) => updateDashboardsPerm(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {!isLocked && (
              <Button onClick={handleSaveDraft} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </div>
          )
        })()}
      </div>
    </div>
  )
}