"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface QuoteSettings {
  quotePrefix: string
  quoteExpiryDays: number
  quoteTerms: string
  quoteDefaultCc: string
  quoteApprovalThreshold: number | null
  quoteSendFromMode: "CREATOR" | "SPECIFIC"
  quoteSendFromConnectionId: string | null
}

interface MailboxOption {
  id: string
  label: string
  email: string
}

export function QuoteSettingsPanel() {
  const [settings, setSettings] = useState<QuoteSettings>({
    quotePrefix: "Q",
    quoteExpiryDays: 30,
    quoteTerms: "",
    quoteDefaultCc: "",
    quoteApprovalThreshold: null,
    quoteSendFromMode: "CREATOR",
    quoteSendFromConnectionId: null,
  })
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/quote-settings")
      .then((res) => res.json())
      .then((json) => {
        setSettings(json)
        setLoading(false)
      })
    fetch("/api/microsoft-connections")
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setMailboxes(data))
  }, [])

  function update(field: string, value: string | number | null) {
    setSettings({ ...settings, [field]: value } as QuoteSettings)
  }

  async function handleSave() {
    setSaving(true)

    const res = await fetch("/api/quote-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })

    setSaving(false)
    if (res.ok) {
      toast.success("Quote settings saved")
    } else {
      toast.error("Couldn't save quote settings")
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Quote Number Prefix</label>
          <input
            type="text"
            value={settings.quotePrefix}
            onChange={(e) => update("quotePrefix", e.target.value)}
            className="w-32 rounded-md border px-3 py-2 text-sm"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Example: with prefix "{settings.quotePrefix}", quotes will be numbered {settings.quotePrefix}-00001, {settings.quotePrefix}-00002, etc.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Default Expiry (days)</label>
          <input
            type="number"
            value={settings.quoteExpiryDays}
            onChange={(e) => update("quoteExpiryDays", Number(e.target.value))}
            className="w-32 rounded-md border px-3 py-2 text-sm"
          />
          <p className="text-xs text-zinc-500 mt-1">
            New quotes will automatically expire this many days after being sent, unless overridden.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Default Terms & Conditions</label>
          <textarea
            value={settings.quoteTerms}
            onChange={(e) => update("quoteTerms", e.target.value)}
            rows={5}
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="This text will appear at the bottom of every quote by default."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Default CC Email</label>
          <input
            type="email"
            value={settings.quoteDefaultCc}
            onChange={(e) => update("quoteDefaultCc", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="e.g. sales@tipinc.com"
          />
          <p className="text-xs text-zinc-500 mt-1">
            This address will be automatically CC'd whenever a quote is sent.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Manager Approval Threshold ($)</label>
          <input
            type="number"
            value={settings.quoteApprovalThreshold ?? ""}
            onChange={(e) => update("quoteApprovalThreshold", e.target.value ? Number(e.target.value) : null)}
            className="w-40 rounded-md border px-3 py-2 text-sm"
            placeholder="Leave blank to disable"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Quotes totaling more than this amount will require manager approval before sending. Leave blank to turn this off.
          </p>
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Send Quotes From</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Controls which mailbox quote emails are sent from.
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="sendFromMode"
              checked={settings.quoteSendFromMode === "CREATOR"}
              onChange={() => update("quoteSendFromMode", "CREATOR")}
              className="mt-1"
            />
            <span>
              <span className="font-medium">The rep who created the quote</span>
              <br />
              <span className="text-xs text-zinc-500">
                Uses each user's own connected mailbox (from signing in with Microsoft SSO, or
                connecting their own mailbox). If that rep hasn't connected a mailbox, sending
                will fail until they do.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="sendFromMode"
              checked={settings.quoteSendFromMode === "SPECIFIC"}
              onChange={() => update("quoteSendFromMode", "SPECIFIC")}
              className="mt-1"
            />
            <span>
              <span className="font-medium">A specific mailbox</span>
              <br />
              <span className="text-xs text-zinc-500">
                Every quote sends from the same address, regardless of who created it — e.g. a
                shared "quotes@" inbox.
              </span>
            </span>
          </label>
        </div>

        {settings.quoteSendFromMode === "SPECIFIC" && (
          <div className="pl-6">
            {mailboxes.length === 0 ? (
              <p className="text-xs text-amber-600">
                No mailboxes are connected yet. Connect one under Microsoft Integration first.
              </p>
            ) : (
              <select
                value={settings.quoteSendFromConnectionId ?? ""}
                onChange={(e) => update("quoteSendFromConnectionId", e.target.value || null)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Select a mailbox...</option>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.email})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}