"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Lock } from "lucide-react"
import { PageHeader } from "@/components/ui/blocks"
import { toast } from "@/lib/toast"
import { previewTheme } from "@/lib/theme-preview"
import { describeTheme, resolveTheme, type ResolvedTheme, type RowDensityChoice, type SidebarStyle, type ThemeModeChoice } from "@/lib/theme"
import type { PreferencesPatch } from "@/lib/appearance-rules"
import { AccentPicker, DensityPicker, ModeSwitch, SidebarStylePicker, StatusColorsCard } from "./AppearanceControls"

export interface StoredPreferences {
  themeAccent: string | null
  themeSidebar: SidebarStyle | null
  themeMode: ThemeModeChoice | null
  rowDensity: RowDensityChoice | null
}

// My settings > Appearance, as the design draws it. Every change shows on
// the whole page at once (previewTheme) and saves straight away; a refused
// save puts the old look back and says why. While the company has turned
// personal colors off, the colors show the company theme read only, and
// only row density can change.
export function MyAppearance({
  initial,
  company,
  allowUserTheme,
}: {
  initial: StoredPreferences
  company: ResolvedTheme
  allowUserTheme: boolean
}) {
  const router = useRouter()
  const [prefs, setPrefs] = useState<StoredPreferences>(initial)
  const companyInput = { themeAccent: company.accent, themeSidebar: company.sidebar, themeMode: company.mode, allowUserTheme }
  const theme = resolveTheme(companyInput, prefs)
  const locked = !allowUserTheme
  const hasOwnColors = !!(prefs.themeAccent || prefs.themeSidebar || prefs.themeMode)

  // The accent saves once a pick or typing settles, so arrowing through
  // the swatches doesn't send a save per color
  const accentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saved = useRef<StoredPreferences>(initial)
  // Leaving the page sends anything still waiting; the saved theme then
  // comes from the server again
  const flushRef = useRef<() => void>(() => undefined)
  useEffect(() => () => {
    flushRef.current()
    previewTheme(null)
  }, [])

  async function send(patch: PreferencesPatch) {
    const res = await fetch("/api/account/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) {
      toast.error("Couldn't save your appearance", typeof data.error === "string" ? data.error : "Please try again.")
      // Back to what was last saved
      setPrefs(saved.current)
      previewTheme(resolveTheme(companyInput, saved.current))
      return
    }
    saved.current = data.preferences as StoredPreferences
    // The layouts read the saved theme and density on the server
    router.refresh()
  }

  // Changes not sent yet, sent together
  const pending = useRef<PreferencesPatch>({})
  function flush() {
    if (accentTimer.current) clearTimeout(accentTimer.current)
    accentTimer.current = null
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length > 0) void send(patch)
  }
  useEffect(() => {
    flushRef.current = flush
  })

  function change(patch: Partial<StoredPreferences>, { debounce = false } = {}) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    if ("themeAccent" in patch || "themeSidebar" in patch || "themeMode" in patch) previewTheme(resolveTheme(companyInput, next))
    pending.current = { ...pending.current, ...patch }
    if (debounce) {
      if (accentTimer.current) clearTimeout(accentTimer.current)
      accentTimer.current = setTimeout(flush, 450)
    } else {
      flush()
    }
  }

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-[18px]">
      <PageHeader
        breadcrumbs={{ items: [{ label: "My settings", href: "/dashboard/account" }], current: "Appearance" }}
        title="Appearance"
        subtitle={locked ? "Your company sets the colors for everyone. Row density is yours to choose." : "These are your personal colors. Your company's defaults apply until you change them."}
      />

      <div role="status" className="flex flex-wrap items-center gap-3 rounded-card bg-acc-tint px-4 py-3 text-acc-ink">
        {locked ? <Lock size={18} aria-hidden="true" /> : <Building2 size={18} aria-hidden="true" />}
        <span className="min-w-[220px] flex-1">
          Company default: {describeTheme(company)}.{" "}
          {locked ? "Your company has turned off personal colors, so everyone sees the company theme." : "Your company allows personal colors."}
        </span>
        {!locked && (
          <button
            type="button"
            disabled={!hasOwnColors}
            onClick={() => change({ themeAccent: null, themeSidebar: null, themeMode: null })}
            className="min-h-[34px] rounded-control border border-current bg-transparent px-3 py-[7px] font-semibold text-inherit transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset to company default
          </button>
        )}
      </div>

      <AccentPicker value={theme.accent} disabled={locked} onChange={(hex) => change({ themeAccent: hex }, { debounce: true })} />
      <SidebarStylePicker value={theme.sidebar} accent={theme.accent} disabled={locked} onChange={(s) => change({ themeSidebar: s })} />
      <ModeSwitch value={theme.mode} disabled={locked} onChange={(m) => change({ themeMode: m })} />
      <DensityPicker value={prefs.rowDensity ?? "DEFAULT"} onChange={(d) => change({ rowDensity: d })} />
      <StatusColorsCard />
    </div>
  )
}
