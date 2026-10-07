"use client"

import { useState, useEffect, type ReactNode } from "react"
import { GripVertical, Lock } from "lucide-react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { roleDisplayColor } from "@/lib/role-colors"
import { RolePill } from "@/components/roles/RolePill"
import { RoleColorPicker } from "@/components/roles/RoleColorPicker"

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
  isEveryone: boolean
  color: string | null
  // How many users hold this role (0 for Everyone, which is implicit)
  userCount: number
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

// One row in the role list. Rows that can be dragged get a grip handle in
// the left gutter; rows that can't (Global Admin, Everyone, and roles at or
// above your own rank) show a lock there instead, with lockReason as the
// explanation.
function RoleListRow({
  role,
  selected,
  onSelect,
  handle,
  lockReason,
}: {
  role: Role
  selected: boolean
  onSelect: () => void
  handle?: ReactNode
  lockReason?: string
}) {
  return (
    <div
      className={`flex items-center rounded-md border text-sm ${
        selected
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-background hover:bg-zinc-50 dark:hover:bg-zinc-800"
      }`}
    >
      <span className="flex w-7 shrink-0 items-center justify-center self-stretch">
        {handle ?? (lockReason ? <Lock size={12} className="opacity-50" aria-hidden="true" /> : null)}
      </span>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={lockReason}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: roleDisplayColor(role) }}
          aria-hidden="true"
        />
        <span className="truncate">{role.name}</span>
        {lockReason && <span className="sr-only">({lockReason})</span>}
      </button>
    </div>
  )
}

// A draggable role row. Only the grip handle starts a drag (mouse, touch,
// or keyboard: focus the handle, Space to pick up, arrows to move, Space to
// drop, Escape to cancel), so clicking the name still just selects it.
function SortableRoleRow({
  role,
  selected,
  onSelect,
  disabled,
}: {
  role: Role
  selected: boolean
  onSelect: () => void
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: role.id,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "relative z-10 scale-[1.02] rounded-md shadow-popover" : undefined}
    >
      <RoleListRow
        role={role}
        selected={selected}
        onSelect={onSelect}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${role.name}`}
            className="flex h-full w-full cursor-grab touch-none items-center justify-center rounded-l-md opacity-60 hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <GripVertical size={14} aria-hidden="true" />
          </button>
        }
      />
    </div>
  )
}

function cloneRole(role: Role | null | undefined): Role | null {
  return role ? (JSON.parse(JSON.stringify(role)) as Role) : null
}

export function RolesPermissionsPanel() {
  const [roles, setRoles] = useState<Role[]>([])
  // Your own highest rank, the same number the server's hierarchy rules
  // use (Global Admin is effectively infinite). Null until it loads, which
  // keeps every role locked rather than briefly looking editable.
  const [myRank, setMyRank] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState<Role | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Loads the roles and your own rank together. Ranks get renumbered when
  // roles are created or reordered (your own role's number included), so
  // they're always refreshed as a pair to keep the locks consistent.
  // resetDraftTo replaces the editor with that role's saved state (after
  // creating, saving, or deleting). Leaving it out (after a reorder) keeps
  // any unsaved edits in the editor.
  function loadAll(resetDraftTo?: string | null) {
    Promise.all([
      fetch("/api/roles").then((res) => res.json()),
      fetch("/api/auth/session").then((res) => res.json()),
    ]).then(([data, session]: [Role[], { user?: { access?: { isGlobalAdmin?: boolean; rank?: number } | null } }]) => {
      const access = session?.user?.access
      setRoles(data)
      setMyRank(access?.isGlobalAdmin ? Number.MAX_SAFE_INTEGER : access?.rank ?? 0)
      setLoading(false)
      if (resetDraftTo !== undefined) {
        setSelectedId(resetDraftTo)
        setDraft(cloneRole(data.find((r) => r.id === resetDraftTo)))
      }
    })
  }

  useEffect(() => {
    loadAll()
  }, [])

  function selectRole(id: string) {
    setSelectedId(id)
    setDraft(cloneRole(roles.find((r) => r.id === id)))
    setError("")
  }

  // Ranked at or above your own. The API rejects edits, deletes, and moves
  // of these regardless, this just keeps the UI from suggesting you can.
  const isRankLocked = (role: Role) => myRank === null || role.rank >= myRank

  // Global Admin is pinned at the top and Everyone at the bottom. Between
  // them, roles at or above your rank always sort to the top (they outrank
  // everything you can move), so they render as a fixed block and the
  // draggable list sits underneath, which means anything you drag can only
  // ever land below your own rank.
  const globalAdminRole = roles.find((r) => r.isGlobalAdmin)
  const everyoneRole = roles.find((r) => r.isEveryone)
  const regularRoles = roles.filter((r) => !r.isGlobalAdmin && !r.isEveryone)
  const lockedRegularRoles = regularRoles.filter((r) => isRankLocked(r))
  const movableRoles = regularRoles.filter((r) => !isRankLocked(r))

  const roleName = (id: UniqueIdentifier) => roles.find((r) => r.id === String(id))?.name ?? "role"
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${roleName(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${roleName(active.id)} is over ${roleName(over.id)}.` : `${roleName(active.id)} is no longer over a role.`,
    onDragEnd: ({ active, over }) =>
      over ? `${roleName(active.id)} was dropped at ${roleName(over.id)}'s position.` : `${roleName(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${roleName(active.id)} was cancelled.`,
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = movableRoles.findIndex((r) => r.id === active.id)
    const to = movableRoles.findIndex((r) => r.id === over.id)
    if (from < 0 || to < 0) return

    // Exactly the order now on screen is what gets saved
    const nextRegular = [...lockedRegularRoles, ...arrayMove(movableRoles, from, to)]
    const previous = roles
    setRoles([
      ...(globalAdminRole ? [globalAdminRole] : []),
      ...nextRegular,
      ...(everyoneRole ? [everyoneRole] : []),
    ])
    setReordering(true)
    const res = await fetch("/api/roles/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleIds: nextRegular.map((r) => r.id) }),
    })
    setReordering(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setRoles(previous)
      toast.error("Couldn't save the new role order", err.error)
      return
    }
    toast.success("Role order saved")
    loadAll()
  }

  async function handleCreateRole() {
    if (!newRoleName.trim()) return
    setError("")
    setSaving(true)
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newRoleName.trim() }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      return
    }
    toast.success(`Role "${newRoleName.trim()}" created`)
    setNewRoleName("")
    setShowNew(false)
    loadAll(data.id)
  }

  async function handleSaveDraft() {
    if (!draft) return
    setError("")
    setSaving(true)
    const res = await fetch(`/api/roles/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        permissions: draft.permissions,
        // Everyone's color is fixed, so it's never sent
        ...(draft.isEveryone ? {} : { color: draft.color }),
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      return
    }
    toast.success("Role updated")
    loadAll(draft.id)
  }

  async function handleDelete(role: Role) {
    const holders = roles.find((r) => r.id === role.id)?.userCount ?? 0
    const confirmed = await confirmDialog({
      title: `Delete the "${role.name}" role?`,
      description:
        holders > 0
          ? `${holders} ${holders === 1 ? "user" : "users"} will lose this role. This can't be undone.`
          : "No users hold this role. This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setError("")
    const res = await fetch(`/api/roles/${role.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Something went wrong.")
      toast.error("Couldn't delete role", data.error)
      return
    }
    toast.success(`Role "${role.name}" deleted`)
    loadAll(null)
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
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* Role list, highest rank at the top */}
      <div className="w-full space-y-2 md:w-60 md:flex-shrink-0">
        <p className="text-xs text-zinc-500">
          Roles higher in the list outrank the ones below. Drag a role by its handle to reorder it.
        </p>
        <div className="space-y-1.5">
          {globalAdminRole && (
            <RoleListRow
              role={globalAdminRole}
              selected={selectedId === globalAdminRole.id}
              onSelect={() => selectRole(globalAdminRole.id)}
              lockReason="Always pinned to the top"
            />
          )}
          {lockedRegularRoles.map((r) => (
            <RoleListRow
              key={r.id}
              role={r}
              selected={selectedId === r.id}
              onSelect={() => selectRole(r.id)}
              lockReason="At or above your rank, so you can't move it"
            />
          ))}
          <DndContext
            id="roles-order"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements }}
          >
            <SortableContext items={movableRoles.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {movableRoles.map((r) => (
                <SortableRoleRow
                  key={r.id}
                  role={r}
                  selected={selectedId === r.id}
                  onSelect={() => selectRole(r.id)}
                  disabled={reordering}
                />
              ))}
            </SortableContext>
          </DndContext>
          {everyoneRole && (
            <RoleListRow
              role={everyoneRole}
              selected={selectedId === everyoneRole.id}
              onSelect={() => selectRole(everyoneRole.id)}
              lockReason="Always pinned to the bottom"
            />
          )}
        </div>

        {showNew ? (
          <div className="rounded-md border p-3 space-y-2">
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Role name"
              aria-label="New role name"
              className="w-full rounded-md border px-2 py-1.5 text-sm"
            />
            <p className="text-xs text-zinc-500">
              New roles start at the bottom, just above Everyone. Drag to move it up afterward.
            </p>
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
          <p className="text-sm text-zinc-500">Select a role from the list, or create a new one.</p>
        )}

        {draft && (() => {
          // Lock against the saved role, not the draft: a reorder renumbers
          // ranks without touching the draft's copy
          const savedRole = roles.find((r) => r.id === draft.id) ?? draft
          const rankLocked = !draft.isGlobalAdmin && isRankLocked(savedRole)
          const isLocked = draft.isGlobalAdmin || rankLocked
          // Everyone keeps its fixed name, color, and position and can never
          // be deleted, but its permissions stay editable like any other role
          const identityLocked = isLocked || draft.isEveryone
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

            {draft.isEveryone && !isLocked && (
              <div className="rounded-md border border-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-600 dark:text-zinc-400">
                Every user in the company automatically has the Everyone role. Its name, color, and place at the bottom are fixed and it can&apos;t be deleted, but its permissions can be edited.
              </div>
            )}

            {rankLocked && (
              <div className="rounded-md border border-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-600 dark:text-zinc-400">
                This role is ranked at or above your own. You can only edit roles below you in the hierarchy.
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 flex-1">
                <label htmlFor="role-name" className="block text-xs text-zinc-500 mb-1">Role Name</label>
                <input
                  id="role-name"
                  type="text"
                  value={draft.name}
                  disabled={identityLocked}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                />
              </div>
              {!identityLocked && (
                <Button variant="outline" onClick={() => handleDelete(draft)} className="text-red-600 hover:text-red-700">
                  Delete Role
                </Button>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Color</h3>
              {draft.isGlobalAdmin || draft.isEveryone ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                  <RolePill role={draft} locked />
                  {draft.isGlobalAdmin ? "Global Admin always uses this color." : "Everyone always uses neutral gray."}
                </p>
              ) : (
                <div className="space-y-3">
                  <RoleColorPicker
                    key={draft.id}
                    value={draft.color}
                    onChange={(color) => setDraft({ ...draft, color })}
                    disabled={isLocked}
                  />
                  <p className="flex items-center gap-2 text-xs text-zinc-500">
                    Preview <RolePill role={draft} />
                  </p>
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-2">Page Access</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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