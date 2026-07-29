"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface CredSettings {
  microsoftClientId: string
  microsoftTenantId: string
  hasClientSecret: boolean
  ssoEnabled: boolean
}

interface Connection {
  id: string
  label: string
  email: string
  connectedByUser: { name: string } | null
  createdAt: string
}

export function MicrosoftSettingsPanel() {
  const [settings, setSettings] = useState<CredSettings | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [redirectUri, setRedirectUri] = useState("")
  const [showAddForm, setShowAddForm] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [togglingSso, setTogglingSso] = useState(false)
  const [connectError, setConnectError] = useState("")
  const [justConnected, setJustConnected] = useState(false)

  const [form, setForm] = useState({
    microsoftClientId: "",
    microsoftTenantId: "",
    microsoftClientSecret: "",
  })

  function loadCredentials() {
    fetch("/api/microsoft-settings")
      .then((res) => res.json())
      .then((data: CredSettings) => {
        setSettings(data)
        setForm({
          microsoftClientId: data.microsoftClientId,
          microsoftTenantId: data.microsoftTenantId,
          microsoftClientSecret: "",
        })
        setLoading(false)
      })
  }

  function loadConnections() {
    fetch("/api/microsoft-connections")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setConnections(data))
  }

  useEffect(() => {
    loadCredentials()
    loadConnections()
    setRedirectUri(`${window.location.origin}/api/microsoft/callback`)

    // This panel no longer lives on its own route, so read ?connected=/?error=
    // straight off the URL once on mount instead of via useSearchParams
    const params = new URLSearchParams(window.location.search)
    if (params.get("error")) setConnectError(params.get("error") || "")
    if (params.get("connected") === "1") setJustConnected(true)
  }, [])

  async function handleSaveCredentials() {
    setSaving(true)
    const res = await fetch("/api/microsoft-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      toast.success("Azure credentials saved")
    } else {
      toast.error("Couldn't save credentials")
    }
    setForm((prev) => ({ ...prev, microsoftClientSecret: "" }))
    loadCredentials()
  }

  async function handleToggleSso() {
    if (!settings) return
    const next = !settings.ssoEnabled
    if (next && !confirm(
      "Turning on SSO disables password login for EVERY user in your company immediately — " +
      "they'll all sign in with Microsoft from now on. Anyone without a matching Microsoft " +
      "account of the same email won't be able to log in. Continue?"
    )) {
      return
    }
    setTogglingSso(true)
    await fetch("/api/microsoft-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ssoEnabled: next }),
    })
    setTogglingSso(false)
    toast.success(next ? "SSO turned on" : "SSO turned off")
    loadCredentials()
  }

  async function handleRemove(id: string) {
    if (!confirm("Disconnect this mailbox? Anywhere it's currently selected (like Quote Settings) will need a new mailbox chosen.")) return
    setRemovingId(id)
    await fetch(`/api/microsoft-connections/${id}`, { method: "DELETE" })
    setRemovingId(null)
    toast.success("Mailbox disconnected")
    loadConnections()
  }

  function copyRedirectUri() {
    navigator.clipboard.writeText(redirectUri)
    toast.success("Copied to clipboard")
  }

  function startConnect() {
    if (!newLabel.trim()) return
    window.location.href = `/api/microsoft/connect?label=${encodeURIComponent(newLabel.trim())}`
  }

  if (loading || !settings) return <p className="text-sm text-zinc-500">Loading...</p>

  const readyToConnect = !!(settings.microsoftClientId && settings.microsoftTenantId && settings.hasClientSecret)

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        Connect your own Microsoft 365 tenant so PetaCore can send and receive email through
        Outlook. This uses your own Azure App Registration — PetaCore never has access to any
        Microsoft account beyond what's explicitly connected here. You can connect more than
        one mailbox (e.g. a shared "quotes@" inbox alongside individual reps), and choose which
        one to use in other settings pages later (like which mailbox quotes get sent from).
      </p>

      {justConnected && (
        <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
          Mailbox connected successfully.
        </div>
      )}
      
      {connectError && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
          Something went wrong connecting: {connectError.replace(/_/g, " ")}
        </div>
      )}

      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Step 1: Redirect URI</h2>
        <p className="text-xs text-zinc-500">
          In your Azure App Registration, under Authentication, add this exact URL as a Web
          redirect URI (add it again with your local dev URL if you also want to test locally):
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={redirectUri}
            className="flex-1 rounded-md border px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900"
          />
          <Button variant="outline" size="sm" onClick={copyRedirectUri}>
            Copy
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Step 2: Your Azure App Credentials</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Application (Client) ID</label>
          <input
            type="text"
            value={form.microsoftClientId}
            onChange={(e) => setForm({ ...form, microsoftClientId: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Directory (Tenant) ID</label>
          <input
            type="text"
            value={form.microsoftTenantId}
            onChange={(e) => setForm({ ...form, microsoftTenantId: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Client Secret {settings.hasClientSecret && <span className="text-zinc-400 font-normal">(already saved — leave blank to keep it)</span>}
          </label>
          <input
            type="password"
            value={form.microsoftClientSecret}
            onChange={(e) => setForm({ ...form, microsoftClientSecret: e.target.value })}
            placeholder={settings.hasClientSecret ? "••••••••••••" : ""}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSaveCredentials} disabled={saving}>
            {saving ? "Saving..." : "Save Credentials"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Step 3: Connected Mailboxes</h2>
          <Button size="sm" onClick={() => setShowAddForm(!showAddForm)} disabled={!readyToConnect}>
            {showAddForm ? "Cancel" : "+ Connect a Mailbox"}
          </Button>
        </div>

        {!readyToConnect && (
          <p className="text-xs text-zinc-500">Save your Client ID, Tenant ID, and Client Secret above first.</p>
        )}

        {showAddForm && (
          <div className="rounded-md border p-3 space-y-2">
            <label className="block text-sm font-medium">
              Label this mailbox (e.g. "Quotes Inbox", or the person's name)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Quotes Team"
                className="flex-1 rounded-md border px-3 py-2 text-sm"
              />
              <Button onClick={startConnect} disabled={!newLabel.trim()}>
                Continue to Microsoft
              </Button>
            </div>
          </div>
        )}

        {connections.length === 0 && !showAddForm && (
          <p className="text-sm text-zinc-500">No mailboxes connected yet.</p>
        )}

        <div className="space-y-2">
          {connections.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-xs text-zinc-500">
                  {c.email}
                  {c.connectedByUser && ` · connected by ${c.connectedByUser.name}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRemove(c.id)}
                disabled={removingId === c.id}
              >
                {removingId === c.id ? "Removing..." : "Disconnect"}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <h2 className="font-semibold text-sm">Step 4: Single Sign-On</h2>
        <p className="text-xs text-zinc-500">
          Once turned on, every user in your company signs into PetaCore with their Microsoft
          account instead of a password. Their PetaCore account must already exist (an admin
          invites them under Settings → Users) — SSO links to that account by matching email, it
          doesn't create new accounts on its own.
        </p>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">
              {settings.ssoEnabled ? "SSO is ON" : "SSO is OFF"}
            </p>
            <p className="text-xs text-zinc-500">
              {settings.ssoEnabled
                ? "Password login is disabled for everyone in your company."
                : "Users currently sign in with email and password."}
            </p>
          </div>
          <Button
            variant={settings.ssoEnabled ? "outline" : "default"}
            onClick={handleToggleSso}
            disabled={togglingSso || !readyToConnect}
          >
            {togglingSso ? "Saving..." : settings.ssoEnabled ? "Turn Off SSO" : "Turn On SSO"}
          </Button>
        </div>
        {!readyToConnect && (
          <p className="text-xs text-zinc-500">Save your Azure credentials above before enabling SSO.</p>
        )}
      </div>
    </div>
  )
}