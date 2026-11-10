"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/blocks"
import { SidebarLayoutEditor, type SidebarEditorTeam } from "@/components/sidebar-layout/SidebarLayoutEditor"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { diffSidebarLayout, SIDEBAR_FOLDER_KEYS, SIDEBAR_FOLDER_PERMISSION, type SidebarFolderKey, type SidebarLayout } from "@/lib/sidebar-layout"
import type { SidebarCounts } from "@/lib/team-rules"

interface MySidebarData {
  layout: SidebarLayout | null
  allowUserSidebar: boolean
  company: SidebarLayout
  effective: SidebarLayout
}

// Where each folder's teams come from: the same counts the sidebar loads,
// so the list holds exactly the teams the user sees in that folder
const COUNTS_URL: Record<SidebarFolderKey, string> = {
  tickets: "/api/tickets/sidebar-counts",
  opportunities: "/api/opportunities/sidebar-counts",
}

// My settings > Sidebar: the user's own page order, folder settings, and
// default views, saved with a Save button; Reset goes back to the company
// layout. Only the user's own pages and teams are listed, and only what
// differs from the company layout is stored, so later company changes
// still reach the parts the user left alone. While the company has turned
// personal layouts off, the company layout shows read only.
export function MySidebar() {
  const router = useRouter()
  const { can } = useAccess()
  const [data, setData] = useState<MySidebarData | null>(null)
  const [draft, setDraft] = useState<SidebarLayout | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [teams, setTeams] = useState<Partial<Record<SidebarFolderKey, SidebarEditorTeam[]>>>({})

  const folders = SIDEBAR_FOLDER_KEYS.filter((key) => can(`pages.${SIDEBAR_FOLDER_PERMISSION[key]}`))
  const folderList = folders.join(",")

  function take(next: MySidebarData) {
    setData(next)
    setDraft(next.allowUserSidebar ? next.effective : next.company)
  }

  useEffect(() => {
    fetch("/api/account/sidebar")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load"))))
      .then(take)
      .catch(() => setFailed(true))
  }, [])

  // Each folder the user has, with its teams once they load (null until then)
  const folderTeams: Partial<Record<SidebarFolderKey, SidebarEditorTeam[] | null>> = Object.fromEntries(folders.map((key) => [key, teams[key] ?? null]))

  useEffect(() => {
    const keys = folderList ? (folderList.split(",") as SidebarFolderKey[]) : []
    for (const key of keys) {
      fetch(COUNTS_URL[key])
        .then((res) => (res.ok ? res.json() : null))
        .then((counts: SidebarCounts | null) => {
          setTeams((prev) => ({ ...prev, [key]: counts && Array.isArray(counts.teams) ? counts.teams.map((t) => ({ id: t.id, name: t.name })) : [] }))
        })
        .catch(() => setTeams((prev) => ({ ...prev, [key]: [] })))
    }
  }, [folderList])

  const locked = data ? !data.allowUserSidebar : false
  const header = (
    <PageHeader
      breadcrumbs={{ items: [{ label: "My settings", href: "/dashboard/account" }], current: "Sidebar" }}
      title="Sidebar"
      subtitle={locked ? "Your company sets the sidebar layout for everyone." : "Arrange your own sidebar. Your company's layout applies to anything you don't change."}
    />
  )

  if (failed)
    return (
      <div className="flex w-full max-w-[920px] flex-col gap-[18px]">
        {header}
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your sidebar settings. Refresh to try again.</p>
      </div>
    )
  if (!data || !draft)
    return (
      <div className="flex w-full max-w-[920px] flex-col gap-[18px]">
        {header}
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )

  const dirty = !locked && JSON.stringify(draft) !== JSON.stringify(data.effective)

  async function send(method: "PATCH" | "DELETE", body?: unknown): Promise<MySidebarData | null> {
    const res = await fetch("/api/account/sidebar", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) {
      toast.error("Couldn't save your sidebar", typeof json.error === "string" ? json.error : "Please try again.")
      return null
    }
    return json as MySidebarData
  }

  async function save() {
    if (!data || !draft) return
    setSaving(true)
    const next = await send("PATCH", { layout: diffSidebarLayout(data.company, draft) })
    setSaving(false)
    if (!next) return
    take(next)
    toast.success("Sidebar saved")
    // The dashboard layout reads the saved layout on the server
    router.refresh()
  }

  async function reset() {
    setSaving(true)
    const next = await send("DELETE")
    setSaving(false)
    if (!next) return
    take(next)
    toast.success("Sidebar reset to the company default")
    router.refresh()
  }

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-[18px]">
      {header}

      <div role="status" className="flex flex-wrap items-center gap-3 rounded-card bg-acc-tint px-4 py-3 text-acc-ink">
        {locked ? <Lock size={18} aria-hidden="true" /> : <Building2 size={18} aria-hidden="true" />}
        <span className="min-w-[220px] flex-1">
          {locked
            ? "Your company has turned off personal sidebar layouts, so everyone sees the company layout below."
            : data.layout
              ? "You have your own sidebar layout."
              : "You're using your company's sidebar layout."}
        </span>
        {!locked && (
          <button
            type="button"
            disabled={saving || data.layout === null}
            onClick={reset}
            className="min-h-[34px] rounded-control border border-current bg-transparent px-3 py-[7px] font-semibold text-inherit transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset to company default
          </button>
        )}
      </div>

      <SidebarLayoutEditor
        idBase="my-sidebar"
        value={draft}
        onChange={setDraft}
        readOnly={locked}
        canSeeItem={(item) => item.permission === null || can(`pages.${item.permission}`)}
        folderTeams={folderTeams}
      />

      {!locked && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" disabled={saving || !dirty} onClick={() => setDraft(data.effective)}>
            Discard changes
          </Button>
          <Button size="lg" className="px-3.5" disabled={saving || !dirty} onClick={save}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  )
}
