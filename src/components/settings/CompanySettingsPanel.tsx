"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { acceptAttribute, checkUploadBasics } from "@/lib/upload-rules"
import { confirmDialog } from "@/lib/confirm-dialog"
import { PsasyncMark } from "@/components/ui/blocks"
import type { LogoSlot } from "@/lib/company-logo"

// Checked when a logo is picked, so a file the server would refuse is
// never queued for Save
function pickLogo(input: HTMLInputElement, setFile: (file: File | null) => void) {
  const file = input.files?.[0] ?? null
  const problem = file ? checkUploadBasics(file, "LOGO") : null
  if (file && problem) {
    toast.error(problem, file.name)
    input.value = ""
    setFile(null)
    return
  }
  setFile(file)
}

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
  const [removing, setRemoving] = useState<LogoSlot | null>(null)
  const [loading, setLoading] = useState(true)

  // Removes one logo at once (DELETE /api/company-settings/logo, the same
  // permission as uploading), after asking. The app then shows the PSAsync
  // mark, and customers see the company name in its place.
  async function removeLogo(slot: LogoSlot) {
    const confirmed = await confirmDialog({
      title: slot === "secondary" ? "Remove the secondary logo?" : "Remove the primary logo?",
      description:
        slot === "secondary"
          ? "Customer facing quotes will use the primary logo instead, or the company name when there is none."
          : "The app shows the PSAsync mark instead, and customers see the company name where the logo was.",
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!confirmed) return
    setRemoving(slot)
    const res = await fetch(`/api/company-settings/logo?slot=${slot}`, { method: "DELETE" }).catch(() => null)
    setRemoving(null)
    if (!res?.ok) {
      const err = res ? await res.json().catch(() => ({})) : {}
      toast.error("Couldn't remove the logo", err.error ?? "Try again.")
      return
    }
    setData((prev) => (slot === "secondary" ? { ...prev, secondaryLogoUrl: null } : { ...prev, logoUrl: null }))
    if (slot === "secondary") setSecondaryLogoFile(null)
    else setLogoFile(null)
    toast.success(slot === "secondary" ? "Secondary logo removed" : "Logo removed")
  }

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
        const err = await res.json().catch(() => ({}))
        toast.error("Couldn't upload logo", err.error)
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
        const err = await res.json().catch(() => ({}))
        toast.error("Couldn't upload secondary logo", err.error)
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
      const err = await res.json().catch(() => ({}))
      toast.error("Couldn't save company settings", err.error)
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
        <LogoPreview url={data.logoUrl} alt="Company logo" onRemove={() => removeLogo("primary")} busy={removing === "primary" || saving} />
        <input
          type="file"
          accept={acceptAttribute("LOGO")}
          onChange={(e) => pickLogo(e.target, setLogoFile)}
          className="text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Secondary Logo (optional)</label>
        <p className="text-xs text-muted-foreground mb-2">
          Shown on client-facing quotes instead of the primary logo, useful if your primary logo
          is the same color as your brand's primary color and would blend into the quote header.
        </p>
        <LogoPreview url={data.secondaryLogoUrl} alt="Secondary company logo" onRemove={() => removeLogo("secondary")} busy={removing === "secondary" || saving} />
        <input
          type="file"
          accept={acceptAttribute("LOGO")}
          onChange={(e) => pickLogo(e.target, setSecondaryLogoFile)}
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

// One logo slot's preview: the logo with a Remove button, or an empty state
// with the PSAsync mark and "No logo uploaded"
function LogoPreview({ url, alt, onRemove, busy }: { url: string | null; alt: string; onRemove: () => void; busy: boolean }) {
  if (!url) {
    return (
      <div className="mb-2 flex items-center gap-3 rounded-card border border-dashed border-border bg-surface-2 px-3 py-3">
        <PsasyncMark size={40} />
        <span className="text-sm text-muted-foreground">No logo uploaded</span>
      </div>
    )
  }
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3">
      {/* A public logo on the uploads bucket */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="h-16 rounded border" />
      <Button type="button" variant="outline" size="sm" onClick={onRemove} disabled={busy}>
        {busy ? "Removing..." : "Remove"}
      </Button>
    </div>
  )
}
