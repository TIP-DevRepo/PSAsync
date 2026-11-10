"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/blocks"
import { SettingsNoAccess } from "@/components/settings/SettingsNoAccess"
import { Switch } from "@/components/appearance/AppearanceControls"
import { SidebarLayoutEditor, type SidebarEditorTeam } from "@/components/sidebar-layout/SidebarLayoutEditor"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { diffSidebarLayout, layoutFromResolved, PSASYNC_SIDEBAR_LAYOUT, type SidebarLayout } from "@/lib/sidebar-layout"
import { teamsForModule, type TeamModuleFlags } from "@/lib/team-modules"

interface CompanySidebar {
  layout: SidebarLayout | null
  allowUserSidebar: boolean
  effective: SidebarLayout
  teams: (SidebarEditorTeam & TeamModuleFlags)[]
}

const PSASYNC_LAYOUT = layoutFromResolved(PSASYNC_SIDEBAR_LAYOUT)

// Settings > Company Settings > Sidebar: the layout everyone sees until they
// arrange their own (the page order, the team order and open state of each
// folder, and the default views), and whether they may. Saved with a Save
// button, since it changes everyone's sidebar. Only what differs from the
// PSAsync default is stored, so pages added later still find their place.
export function SidebarSettingsPanel() {
  const { can } = useAccess()
  const router = useRouter()
  const allowed = can("settingsSections.company")
  const [saved, setSaved] = useState<CompanySidebar | null>(null)
  const [draft, setDraft] = useState<{ layout: SidebarLayout; allowUserSidebar: boolean } | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  function take(data: CompanySidebar) {
    setSaved(data)
    setDraft({ layout: data.effective, allowUserSidebar: data.allowUserSidebar })
  }

  useEffect(() => {
    if (!allowed) return
    fetch("/api/company-settings/sidebar")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load"))))
      .then(take)
      .catch(() => setFailed(true))
  }, [allowed])

  if (!allowed) return <SettingsNoAccess />
  if (failed) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the sidebar settings. Refresh to try again.</p>
  if (!draft || !saved) return <p className="text-sm text-muted-foreground">Loading...</p>

  const dirty = JSON.stringify(draft) !== JSON.stringify({ layout: saved.effective, allowUserSidebar: saved.allowUserSidebar })

  async function send(method: "PATCH" | "DELETE", body?: unknown): Promise<CompanySidebar | null> {
    const res = await fetch("/api/company-settings/sidebar", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) {
      toast.error("Couldn't save the sidebar", typeof data.error === "string" ? data.error : "Please try again.")
      return null
    }
    return data as CompanySidebar
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    const data = await send("PATCH", { layout: diffSidebarLayout(PSASYNC_LAYOUT, draft.layout), allowUserSidebar: draft.allowUserSidebar })
    setSaving(false)
    if (!data) return
    take(data)
    toast.success("Sidebar saved")
    // Your own sidebar follows it unless you arranged your own
    router.refresh()
  }

  async function reset() {
    const ok = await confirmDialog({
      title: "Reset the sidebar to the PSAsync default?",
      description: "The company's page order, folder settings, and default views go back to the PSAsync default. Users who arranged their own sidebar keep theirs. The switch for personal layouts stays as it is.",
      confirmLabel: "Reset",
    })
    if (!ok) return
    setSaving(true)
    const data = await send("DELETE")
    setSaving(false)
    if (!data) return
    take(data)
    toast.success("Sidebar reset to the PSAsync default")
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <p className="text-sm text-muted-foreground">
        The sidebar everyone sees until they arrange their own in My settings. People only ever see the pages and teams they have access to, whatever the order here.
      </p>

      <Card>
        <Switch
          id="company-allow-user-sidebar"
          checked={draft.allowUserSidebar}
          onChange={(v) => setDraft({ ...draft, allowUserSidebar: v })}
          label="Let users customise their sidebar"
          description={
            draft.allowUserSidebar
              ? "Each user can arrange their own pages, folders, and default views in My settings."
              : "Everyone sees this layout. Saved personal layouts are kept and come back if you turn this on again."
          }
        />
      </Card>

      <SidebarLayoutEditor
        idBase="company-sidebar"
        value={draft.layout}
        onChange={(layout) => setDraft({ ...draft, layout })}
        canSeeItem={() => true}
        // Each folder only holds the teams that use its module
        folderTeams={{ tickets: teamsForModule(saved.teams, "tickets"), opportunities: teamsForModule(saved.teams, "opportunities") }}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" disabled={saving || saved.layout === null} onClick={reset} title="Go back to the PSAsync default layout">
          Reset to PSAsync default
        </Button>
        <Button variant="outline" disabled={saving || !dirty} onClick={() => take(saved)}>
          Discard changes
        </Button>
        <Button size="lg" className="px-3.5" disabled={saving || !dirty} onClick={save}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}
