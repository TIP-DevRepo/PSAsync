"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardHeader } from "@/components/ui/blocks"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { companyTheme, describeTheme, PSASYNC_ACCENT, type ResolvedTheme, type SidebarStyle, type ThemeModeChoice } from "@/lib/theme"
import { AccentPicker, ModeSwitch, SidebarStylePicker, StatusColorsCard, Switch, ThemePreviewPair } from "@/components/appearance/AppearanceControls"

interface CompanyAppearance {
  themeAccent: string | null
  themeSidebar: SidebarStyle | null
  themeMode: ThemeModeChoice | null
  allowUserTheme: boolean
}

// Settings > Company Settings > Appearance: the theme everyone sees until
// they choose their own, and whether they may. The same controls as My
// settings > Appearance, with a picture of both modes instead of changing
// the whole page, and a Save button, since it changes everyone's colors.
export function CompanyAppearancePanel() {
  const { can } = useAccess()
  const router = useRouter()
  const allowed = can("settingsSections.company")
  const [saved, setSaved] = useState<CompanyAppearance | null>(null)
  const [draft, setDraft] = useState<CompanyAppearance | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!allowed) return
    fetch("/api/company-settings/appearance")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load"))))
      .then((data: CompanyAppearance) => {
        const value = { themeAccent: data.themeAccent, themeSidebar: data.themeSidebar, themeMode: data.themeMode, allowUserTheme: data.allowUserTheme }
        setSaved(value)
        setDraft(value)
      })
      .catch(() => setFailed(true))
  }, [allowed])

  if (!allowed) return <SettingsNoAccess />
  if (failed) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the appearance settings. Refresh to try again.</p>
  if (!draft || !saved) return <p className="text-sm text-muted-foreground">Loading...</p>

  const theme: ResolvedTheme = companyTheme(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const isDefault = !draft.themeAccent && !draft.themeSidebar && !draft.themeMode
  const update = (patch: Partial<CompanyAppearance>) => setDraft({ ...draft, ...patch })

  async function save() {
    if (!draft) return
    setSaving(true)
    const res = await fetch("/api/company-settings/appearance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setSaving(false)
    if (!res || !res.ok) {
      toast.error("Couldn't save the appearance", typeof data.error === "string" ? data.error : "Please try again.")
      return
    }
    const value = { themeAccent: data.themeAccent, themeSidebar: data.themeSidebar, themeMode: data.themeMode, allowUserTheme: data.allowUserTheme }
    setSaved(value)
    setDraft(value)
    toast.success("Appearance saved")
    // Your own view follows it unless you have your own colors
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <p className="text-sm text-muted-foreground">
        The colors everyone sees until they choose their own in My settings. Customer facing quotes, PDFs, and the customer portal keep using the brand colors in Company Info &amp; Branding.
      </p>

      <Card className="flex flex-col gap-4">
        <CardHeader title="Preview" description={`${describeTheme(theme)}.`} />
        <ThemePreviewPair theme={theme} />
      </Card>

      <Card>
        <Switch
          id="company-allow-user-theme"
          checked={draft.allowUserTheme}
          onChange={(v) => update({ allowUserTheme: v })}
          label="Allow users to change their colors"
          description={
            draft.allowUserTheme
              ? "Each user can pick their own accent, sidebar style, and mode. Row density is always their own."
              : "Everyone sees the company theme. Users can still choose their row density."
          }
        />
      </Card>

      <AccentPicker value={theme.accent} onChange={(hex) => update({ themeAccent: hex })} />
      <SidebarStylePicker value={theme.sidebar} accent={theme.accent} onChange={(s) => update({ themeSidebar: s })} />
      <ModeSwitch value={theme.mode} onChange={(m) => update({ themeMode: m })} />
      <StatusColorsCard />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={saving || isDefault}
          onClick={() => update({ themeAccent: null, themeSidebar: null, themeMode: null })}
          title={`PSAsync indigo (${PSASYNC_ACCENT}), dark sidebar, light mode`}
        >
          Use the PSAsync default
        </Button>
        <Button variant="outline" disabled={saving || !dirty} onClick={() => setDraft(saved)}>
          Discard changes
        </Button>
        <Button size="lg" className="px-3.5" disabled={saving || !dirty} onClick={save}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}
