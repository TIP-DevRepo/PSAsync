"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface RoleOption {
  id: string
  name: string
  isEveryone?: boolean
}

interface UserOption {
  id: string
  name: string
  active: boolean
}

interface NotifyRule {
  type: "user" | "role"
  id: string
}

interface SOPOSettings {
  soPrefix: string
  poPrefix: string
  poDefaultPaymentType: string
  soStatusNotifyRules: Record<string, NotifyRule | null>
}

const NOTIFY_STATUSES: { key: string; label: string }[] = [
  { key: "READY_TO_INVOICE", label: "Ready to Invoice" },
  { key: "READY_TO_ORDER", label: "Ready to Order" },
  { key: "READY_TO_CLOSEOUT", label: "Ready to Closeout" },
]

export function SalesOrderSettingsPanel() {
  const [settings, setSettings] = useState<SOPOSettings>({
    soPrefix: "SO",
    poPrefix: "PO",
    poDefaultPaymentType: "Net30",
    soStatusNotifyRules: {},
  })
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    fetch("/api/so-po-settings")
      .then((res) => res.json())
      .then((json) => {
        setSettings({ ...json, soStatusNotifyRules: json.soStatusNotifyRules ?? {} })
        setLoading(false)
      })
    fetch("/api/roles")
      .then((res) => res.json())
      .then((data: RoleOption[]) => setRoles(data.filter((r) => !r.isEveryone)))
    fetch("/api/users")
      .then((res) => res.json())
      .then((data: (UserOption & { active: boolean })[]) => setUsers(data.filter((u) => u.active)))
  }, [])

  function update(field: keyof Omit<SOPOSettings, "soStatusNotifyRules">, value: string) {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  function updateNotifyRule(statusKey: string, rule: NotifyRule | null) {
    setSettings((prev) => ({
      ...prev,
      soStatusNotifyRules: { ...prev.soStatusNotifyRules, [statusKey]: rule },
    }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage("")
    const res = await fetch("/api/so-po-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    if (res.ok) {
      setMessage("Saved successfully.")
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error("Couldn't save sales order settings", data.error)
    }
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Sales Order Number Prefix</label>
          <input
            type="text"
            value={settings.soPrefix}
            onChange={(e) => update("soPrefix", e.target.value)}
            className="w-32 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Purchase Order Number Prefix</label>
          <input
            type="text"
            value={settings.poPrefix}
            onChange={(e) => update("poPrefix", e.target.value)}
            className="w-32 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Default PO Payment Terms</label>
          <input
            type="text"
            value={settings.poDefaultPaymentType}
            onChange={(e) => update("poDefaultPaymentType", e.target.value)}
            placeholder="e.g. Net30"
            className="w-40 rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-4">
        <div>
          <h3 className="font-semibold text-sm">Sales Order Status Notifications</h3>
          <p className="text-xs text-zinc-500 mt-1">
            When a Sales Order is manually changed to one of these statuses, notify a specific
            person or everyone holding a specific role — in-app and by email.
          </p>
        </div>

        {NOTIFY_STATUSES.map(({ key, label }) => {
          const rule = settings.soStatusNotifyRules[key] ?? null
          return (
            <div key={key} className="flex items-center gap-3">
              <label className="w-40 text-sm font-medium flex-shrink-0">{label}</label>
              <select
                value={rule?.type ?? ""}
                onChange={(e) => {
                  const type = e.target.value as "user" | "role" | ""
                  if (!type) {
                    updateNotifyRule(key, null)
                  } else {
                    updateNotifyRule(key, { type, id: "" })
                  }
                }}
                className="rounded-md border px-2 py-2 text-sm"
              >
                <option value="">No notification</option>
                <option value="user">Specific user</option>
                <option value="role">Everyone with role</option>
              </select>

              {rule?.type === "user" && (
                <select
                  value={rule.id}
                  onChange={(e) => updateNotifyRule(key, { type: "user", id: e.target.value })}
                  className="flex-1 rounded-md border px-2 py-2 text-sm"
                >
                  <option value="">Select a user...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}

              {rule?.type === "role" && (
                <select
                  value={rule.id}
                  onChange={(e) => updateNotifyRule(key, { type: "role", id: e.target.value })}
                  className="flex-1 rounded-md border px-2 py-2 text-sm"
                >
                  <option value="">Select a role...</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>

      {message && <p className="text-sm text-green-600">{message}</p>}
    </div>
  )
}