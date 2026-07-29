"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface NotificationSettings {
  emailDefaultCc: string
  emailSignature: string
}

export function NotificationSettingsPanel() {
  const [settings, setSettings] = useState<NotificationSettings>({
    emailDefaultCc: "",
    emailSignature: "",
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/notification-settings")
      .then((res) => res.json())
      .then((json) => {
        setSettings(json)
        setLoading(false)
      })
  }, [])

  function update(field: string, value: string) {
    setSettings({ ...settings, [field]: value })
  }

  async function handleSave() {
    setSaving(true)

    const res = await fetch("/api/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })

    setSaving(false)
    if (res.ok) {
      toast.success("Notification settings saved")
    } else {
      toast.error("Couldn't save notification settings")
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">
        These settings control the shared defaults used by quote-viewed / approved / lost
        notification emails.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Default CC Email</label>
          <input
            type="email"
            value={settings.emailDefaultCc}
            onChange={(e) => update("emailDefaultCc", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="e.g. sales@tipinc.com"
          />
          <p className="text-xs text-zinc-500 mt-1">
            This address will be CC'd on notification emails by default.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Email Signature</label>
          <textarea
            value={settings.emailSignature}
            onChange={(e) => update("emailSignature", e.target.value)}
            rows={5}
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="This will appear at the bottom of notification emails."
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}