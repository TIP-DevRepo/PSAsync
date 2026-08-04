"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"

interface CompanyData {
  name: string
  logoUrl: string | null
  secondaryLogoUrl: string | null
  primaryColor: string
  accentColor: string
}

export function CompanySettingsPanel() {
  const [data, setData] = useState<CompanyData>({
    name: "",
    logoUrl: null,
    secondaryLogoUrl: null,
    primaryColor: "#1B3A5C",
    accentColor: "#2E86AB",
  })
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [secondaryLogoFile, setSecondaryLogoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/company-settings")
      .then((res) => res.json())
      .then((json) => {
        setData(json)
        setLoading(false)
      })
  }, [])

  async function handleSave() {
    setSaving(true)

    if (logoFile) {
      const formData = new FormData()
      formData.append("file", logoFile)
      formData.append("slot", "primary")
      const res = await fetch("/api/company-settings/logo", {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        setSaving(false)
        toast.error("Couldn't upload logo")
        return
      }
      const json = await res.json()
      data.logoUrl = json.logoUrl
    }

    if (secondaryLogoFile) {
      const formData = new FormData()
      formData.append("file", secondaryLogoFile)
      formData.append("slot", "secondary")
      const res = await fetch("/api/company-settings/logo", {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        setSaving(false)
        toast.error("Couldn't upload secondary logo")
        return
      }
      const json = await res.json()
      data.secondaryLogoUrl = json.logoUrl
    }

    const res = await fetch("/api/company-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        primaryColor: data.primaryColor,
        accentColor: data.accentColor,
      }),
    })

    setSaving(false)
    if (res.ok) {
      toast.success("Company settings saved")
    } else {
      toast.error("Couldn't save company settings")
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading...</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1">Company Name</label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Primary Logo</label>
        <p className="text-xs text-muted-foreground mb-2">
          Used across the app (sidebar, favicon-adjacent branding). Keep this on a neutral/transparent background.
        </p>
        {data.logoUrl && (
          <img
            src={data.logoUrl}
            alt="Company logo"
            className="h-16 mb-2 rounded border"
          />
        )}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Secondary Logo (optional)</label>
        <p className="text-xs text-muted-foreground mb-2">
          Shown on client-facing quotes instead of the primary logo — useful if your primary logo
          is the same color as your brand's primary color and would blend into the quote header.
        </p>
        {data.secondaryLogoUrl && (
          <img
            src={data.secondaryLogoUrl}
            alt="Secondary company logo"
            className="h-16 mb-2 rounded border"
          />
        )}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setSecondaryLogoFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Primary Color</label>
        <input
          type="color"
          value={data.primaryColor}
          onChange={(e) => setData({ ...data, primaryColor: e.target.value })}
          className="h-10 w-20 rounded border"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Accent Color</label>
        <input
          type="color"
          value={data.accentColor}
          onChange={(e) => setData({ ...data, accentColor: e.target.value })}
          className="h-10 w-20 rounded border"
        />
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  )
}