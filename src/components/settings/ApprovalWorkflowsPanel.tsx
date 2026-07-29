"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"

type TriggerType = "TOTAL_THRESHOLD" | "DISCOUNT_THRESHOLD" | "SPECIFIC_USER"

interface RoleOption {
  id: string
  name: string
  rank: number
}

interface Workflow {
  id: string
  name: string
  active: boolean
  triggerType: TriggerType
  thresholdValue: number | null
  triggerUserId: string | null
  triggerUser: { name: string } | null
  requiredRole: RoleOption | null
}

interface UserOption {
  id: string
  name: string
  active: boolean
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  TOTAL_THRESHOLD: "Quote total is at or above a dollar amount",
  DISCOUNT_THRESHOLD: "Any line item's discount is at or above a percentage",
  SPECIFIC_USER: "Quote was created by a specific user",
}

export function ApprovalWorkflowsPanel() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: "",
    triggerType: "TOTAL_THRESHOLD" as TriggerType,
    thresholdValue: "",
    triggerUserId: "",
    requiredRoleId: "",
  })

  function loadWorkflows() {
    fetch("/api/approval-workflows")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setWorkflows(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadWorkflows()
    fetch("/api/users")
      .then((res) => res.json())
      .then((data: UserOption[]) => setUsers(data.filter((u) => u.active)))
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data: RoleOption[]) => {
        setRoles(data)
        if (data.length > 0) {
          setForm((prev) => ({ ...prev, requiredRoleId: prev.requiredRoleId || data[0].id }))
        }
      })
  }, [])

  async function handleCreate() {
    if (!form.name.trim() || !form.requiredRoleId) return
    setSaving(true)
    const res = await fetch("/api/approval-workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        triggerType: form.triggerType,
        thresholdValue: form.triggerType !== "SPECIFIC_USER" ? form.thresholdValue : null,
        triggerUserId: form.triggerType === "SPECIFIC_USER" ? form.triggerUserId : null,
        requiredRoleId: form.requiredRoleId,
      }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success(`Workflow "${form.name}" created`)
    } else {
      toast.error("Couldn't create workflow")
    }
    setShowForm(false)
    setForm({
      name: "",
      triggerType: "TOTAL_THRESHOLD",
      thresholdValue: "",
      triggerUserId: "",
      requiredRoleId: roles[0]?.id ?? "",
    })
    loadWorkflows()
  }

  async function handleToggleActive(w: Workflow) {
    await fetch(`/api/approval-workflows/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !w.active }),
    })
    toast.success(w.active ? `"${w.name}" deactivated` : `"${w.name}" activated`)
    loadWorkflows()
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmDialog({
      title: "Delete this approval workflow?",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    await fetch(`/api/approval-workflows/${id}`, { method: "DELETE" })
    toast.success("Workflow deleted")
    loadWorkflows()
  }

  function describeCondition(w: Workflow) {
    if (w.triggerType === "TOTAL_THRESHOLD") return `Quote total ≥ $${w.thresholdValue?.toFixed(2)}`
    if (w.triggerType === "DISCOUNT_THRESHOLD") return `Any item discount ≥ ${w.thresholdValue}%`
    if (w.triggerType === "SPECIFIC_USER") return `Created by ${w.triggerUser?.name ?? "a specific user"}`
    return ""
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          When a quote matches any active rule below, it can&apos;t be sent until someone with the
          required role approves it.
        </p>
        <Button size="sm" onClick={() => setShowForm(!showForm)} disabled={roles.length === 0}>
          {showForm ? "Cancel" : "+ New Workflow"}
        </Button>
      </div>

      {roles.length === 0 && (
        <p className="text-xs text-amber-600">
          No roles found for your company yet. Roles are needed before you can create an approval workflow.
        </p>
      )}

      {showForm && (
        <div className="rounded-md border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Workflow Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. High Discount Sign-Off"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Trigger Condition</label>
            <select
              value={form.triggerType}
              onChange={(e) => setForm({ ...form, triggerType: e.target.value as TriggerType })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => (
                <option key={t} value={t}>
                  {TRIGGER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {(form.triggerType === "TOTAL_THRESHOLD" || form.triggerType === "DISCOUNT_THRESHOLD") && (
            <div>
              <label className="block text-sm font-medium mb-1">
                {form.triggerType === "TOTAL_THRESHOLD" ? "Dollar Amount" : "Discount Percentage"}
              </label>
              <input
                type="number"
                step="0.01"
                value={form.thresholdValue}
                onChange={(e) => setForm({ ...form, thresholdValue: e.target.value })}
                placeholder={form.triggerType === "TOTAL_THRESHOLD" ? "e.g. 10000" : "e.g. 20"}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )}

          {form.triggerType === "SPECIFIC_USER" && (
            <div>
              <label className="block text-sm font-medium mb-1">User</label>
              <select
                value={form.triggerUserId}
                onChange={(e) => setForm({ ...form, triggerUserId: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Select a user...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Who Must Approve</label>
            <select
              value={form.requiredRoleId}
              onChange={(e) => setForm({ ...form, requiredRoleId: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (or higher)
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={saving || !form.name.trim() || !form.requiredRoleId}>
              {saving ? "Creating..." : "Create Workflow"}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {workflows.length === 0 && (
          <p className="text-sm text-zinc-500">No approval workflows yet. Quotes will send immediately.</p>
        )}
        {workflows.map((w) => (
          <div key={w.id} className="rounded-md border p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm">{w.name}</p>
                {!w.active && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                    Inactive
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                {describeCondition(w)} → requires {w.requiredRole?.name ?? "a role that no longer exists"} or higher
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handleToggleActive(w)}>
                {w.active ? "Deactivate" : "Activate"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleDelete(w.id)}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}