"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Pencil } from "lucide-react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { Timeline, type TimelineHandle } from "@/components/timeline/Timeline"
import { emailUnavailableReason, type EmailOptions } from "@/components/timeline/EmailComposer"
import { ActionButtonBar } from "@/components/timeline/ActionButtonBar"
import { TabsBar } from "@/components/ui/tabs-bar"
import { AuditLogTable } from "@/components/audit/AuditLogTable"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { OPPORTUNITY_TITLE_MAX } from "@/lib/opportunity-rules"
import { formatDate, notifyOpportunitiesChanged, type StageOption, type TypeOption } from "@/lib/opportunity-view"
import type { TeamSummary } from "@/lib/team-rules"
import type { ActionButtonDefinition } from "@/lib/timeline-buttons"
import { opportunityTabHref, readOpportunityTab, tabLabel, visibleOpportunityTabs, type OpportunityTabKey } from "@/lib/opportunity-tabs"
import { noteStageChange } from "@/lib/timeline-actions"
import { defaultEmailSubject } from "@/lib/record-email"
import { StagePill } from "./StagePill"
import { OpportunityRelatedPanel, relatedCount, useOpportunityRelated } from "./OpportunityRelatedPanel"
import { OpportunityAttachments } from "./OpportunityAttachments"
import { DeleteOpportunityDialog } from "./DeleteOpportunityDialog"
import { OpportunityInfoPanel, type OpportunityDetailData } from "./OpportunityInfoPanel"

const breadcrumbItems = [{ label: "Opportunities", href: "/dashboard/opportunities" }]

const NEEDS_EDIT_MESSAGE = "You need edit access to use this"
const DELETED_MESSAGE = "This opportunity is deleted"

// Laid out like HaloPSA: the client and number large on the first line
// (Delete at the top right), the title under it, the action buttons on their
// own row aligned left, then the stage pill with created and closed text. The main column is tabs (src/lib/opportunity-
// tabs.ts, kept in ?tab=): Details (the timeline), Attachments, Related, and
// the Audit log (auditLog.view). The details panel (edited in place) is on
// the right. At phone width the panel comes first, then the tabs.
//
// A deleted opportunity opens only for audit log viewers (the API's 404 for
// everyone else): a banner says who deleted it and when, with Restore for
// auditLog.restore, everything is read only, and only the Audit log tab
// shows, since its other routes answer 404.
export function OpportunityDetail({ id }: { id: string }) {
  const router = useRouter()
  // For hiding controls only: every route checks the same keys itself
  const { access, can } = useAccess()
  const myUserId = access?.userId ?? null
  const canEdit = can("opportunities.edit")
  const canDelete = can("opportunities.delete")
  const canViewAll = can("opportunities.viewAll")

  const [opportunity, setOpportunity] = useState<OpportunityDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [stages, setStages] = useState<StageOption[]>([])
  const [types, setTypes] = useState<TypeOption[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [users, setUsers] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  // Bumped after every change the server records on the timeline, so the
  // timeline shows its new entry
  const [timelineKey, setTimelineKey] = useState(0)
  // The header's action bar opens the timeline's composer
  const timelineRef = useRef<TimelineHandle>(null)
  const [openButtonId, setOpenButtonId] = useState<string | null>(null)
  // The company's buttons for opportunities (Settings > Action Buttons)
  const [buttons, setButtons] = useState<ActionButtonDefinition[]>([])
  // The Email action's From choices, signature, and contacts; loaded when
  // the user can use it
  const [emailOptions, setEmailOptions] = useState<EmailOptions | null>(null)
  const hasEmailButton = buttons.some((b) => b.opens.kind === "email")
  const { related, failed: relatedFailed } = useOpportunityRelated(id)

  // The open tab lives in the URL, so a refresh or a shared link keeps it.
  // It is also held here, so a header button can switch to Details and open
  // the composer in one go; a URL change (back, forward) is followed.
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const deleted = !!opportunity?.deletedAt
  // Editing needs the permission and an opportunity that isn't deleted
  const editable = canEdit && !deleted
  const allTabs = visibleOpportunityTabs(can)
  const tabs = deleted ? allTabs.filter((t) => t.key === "audit") : allTabs
  const urlTab = readOpportunityTab(searchParams, tabs)
  const [tab, setTabState] = useState<OpportunityTabKey>(urlTab)
  const [seenUrlTab, setSeenUrlTab] = useState<OpportunityTabKey>(urlTab)
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab)
    setTabState(urlTab)
  }
  // A deleted opportunity only has its audit log to show
  const activeTab: OpportunityTabKey = deleted ? "audit" : tab
  function setTab(key: OpportunityTabKey) {
    setTabState(key)
    router.replace(opportunityTabHref(pathname, searchParams.toString(), key), { scroll: false })
  }

  // Everyone who can open the opportunity sees its buttons; without edit
  // access they are dimmed and say why. Email also needs a mailbox to send
  // from.
  const unavailableReason = useCallback(
    (button: ActionButtonDefinition): string | null => {
      if (deleted) return DELETED_MESSAGE
      if (!canEdit) return NEEDS_EDIT_MESSAGE
      return button.opens.kind === "email" ? emailUnavailableReason(emailOptions) : null
    },
    [canEdit, deleted, emailOptions]
  )

  // A header button opens the composer at the top of the timeline, on the
  // Details tab
  function openFromHeader(button: ActionButtonDefinition) {
    if (unavailableReason(button)) return
    if (tab !== "details") setTab("details")
    timelineRef.current?.openComposer(button)
  }

  const load = useCallback(() => {
    fetch(`/api/opportunities/${id}`)
      .then((res) => {
        // Someone else's opportunity, one outside the company, or any other
        // refusal all land on the same not found state
        if (!res.ok) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setOpportunity(data)
        setLoading(false)
      })
      .catch(() => {
        setNotFound(true)
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    load()
    const json = (res: Response) => (res.ok ? res.json() : [])
    fetch("/api/opportunity-stages").then(json).then((data) => Array.isArray(data) && setStages(data))
    fetch("/api/action-buttons?for=opportunity").then(json).then((data) => Array.isArray(data) && setButtons(data))
    if (!canEdit) return
    fetch("/api/opportunity-types").then(json).then((data) => Array.isArray(data) && setTypes(data))
    fetch("/api/clients").then(json).then((data) => Array.isArray(data) && setClients(data))
    // Every user's name, for the owner choices (ownerFieldChoices decides who)
    fetch("/api/users").then(json).then((data) => Array.isArray(data) && setUsers(data))
    // The teams it may move to, and who may own it in each
    fetch("/api/teams").then(json).then((data) => Array.isArray(data) && setTeams(data))
  }, [load, canEdit])

  useEffect(() => {
    if (!editable || !hasEmailButton) return
    fetch(`/api/opportunities/${id}/email-options`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EmailOptions | null) => data && setEmailOptions(data))
      .catch(() => undefined)
  }, [id, editable, hasEmailButton])

  // Saves only the fields given. The page takes the saved opportunity back,
  // or keeps what it had (the old value shows again) and says why.
  async function save(patch: Record<string, unknown>, what: string): Promise<boolean> {
    setSaving(true)
    const res = await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      toast.error(`Couldn't save the ${what}`, data.error)
      return false
    }
    setOpportunity(data)
    setTimelineKey((k) => k + 1)
    // The sidebar counts open opportunities by team and owner
    if ("stageId" in patch || "ownerId" in patch || "teamId" in patch) notifyOpportunitiesChanged()
    return true
  }

  async function editTitle(current: string) {
    const title = await promptDialog({ title: "Rename opportunity", defaultValue: current, confirmLabel: "Save" })
    if (title === null || title === current) return
    if (title.length > OPPORTUNITY_TITLE_MAX) {
      toast.error("Couldn't save the title", `Title must be ${OPPORTUNITY_TITLE_MAX} characters or fewer`)
      return
    }
    save({ title }, "title")
  }

  async function handleRestore() {
    const ok = await confirmDialog({
      title: `Restore ${opportunity?.number ?? "this opportunity"}?`,
      description: "It shows in lists again, with its attachments and timeline.",
      confirmLabel: "Restore",
    })
    if (!ok) return
    setSaving(true)
    const res = await fetch(`/api/opportunities/${id}/restore`, { method: "POST" }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setSaving(false)
    if (!res || !res.ok) {
      toast.error("Couldn't restore this opportunity", typeof data.error === "string" ? data.error : "Please try again.")
      return
    }
    toast.success("Opportunity restored")
    setOpportunity(data)
    setTimelineKey((k) => k + 1)
    notifyOpportunitiesChanged()
  }

  async function handleDelete(): Promise<string | null> {
    const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Opportunity deleted")
      notifyOpportunitiesChanged()
      router.push("/dashboard/opportunities")
      return null
    }
    const data = await res.json().catch(() => ({}))
    // A 409 says what it is linked to, shown in the dialog as is
    return typeof data.error === "string" ? data.error : "Couldn't delete this opportunity."
  }

  if (loading) {
    return (
      <div className="w-full">
        <Breadcrumbs items={breadcrumbItems} current={null} />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }
  if (notFound || !opportunity) {
    return (
      <div className="w-full">
        <Breadcrumbs items={breadcrumbItems} current="Not found" />
        <p className="text-sm text-muted-foreground">This opportunity was not found, or you do not have access to it.</p>
      </div>
    )
  }

  const o = opportunity
  const linkedCount = o._count.quotes + o._count.salesOrders + o._count.purchaseOrders
  // Shown on a tab when there is at least one
  const counts: Partial<Record<OpportunityTabKey, number>> = { attachments: o._count.attachments, related: relatedCount(related) }

  return (
    <div className="w-full space-y-6">
      <header className="space-y-3">
        <div>
          <Breadcrumbs items={breadcrumbItems} current={o.number} />
          <Link href="/dashboard/opportunities" className="mb-2 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline">
            ← Back to Opportunities
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {/* Line 1: who the deal is with, and its number */}
            <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-display font-bold tracking-tight text-foreground">
              <Link href={`/dashboard/clients/${o.client.id}`} className="break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {o.client.name}
              </Link>
              <span className="tabular-nums text-muted-foreground">{o.number}</span>
            </h1>
            {/* Line 2: the title, smaller but clear */}
            <p className="flex items-start gap-2 text-lg font-medium text-foreground">
              <span className="break-words">{o.title}</span>
              {editable && (
                <button
                  type="button"
                  onClick={() => editTitle(o.title)}
                  disabled={saving}
                  aria-label="Rename opportunity"
                  className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              )}
            </p>
          </div>
          {canDelete && !deleted && (
            <Button variant="outline" onClick={() => setShowDelete(true)} className="text-danger hover:text-danger">
              Delete
            </Button>
          )}
        </div>

        {/* Line 3: the action buttons on their own row, aligned left; they
            wrap onto more lines at narrow widths */}
        <ActionButtonBar
          buttons={buttons}
          onSelect={openFromHeader}
          activeId={openButtonId}
          unavailableReason={unavailableReason}
          label="Timeline actions"
        />

        {o.deletedAt && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-medium">
              This opportunity was deleted{o.deletedBy ? ` by ${o.deletedBy.name}` : ""} on {formatDate(o.deletedAt)}
            </p>
            {can("auditLog.restore") && (
              <Button variant="outline" onClick={handleRestore} disabled={saving}>
                Restore
              </Button>
            )}
          </div>
        )}

        {/* Line 4: the stage pill, created and closed text */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StagePill name={o.stage.name} category={o.stage.category} />
          <p className="text-xs text-muted-foreground">
            Created{o.createdBy ? ` by ${o.createdBy.name}` : ""} on {formatDate(o.createdAt)}
            {o.closedAt ? ` · Closed ${formatDate(o.closedAt)}` : ""}
          </p>
        </div>
      </header>

      {/* The panel comes first in the page, so at phone width it leads;
          from lg up the grid puts the tabs on the left */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <aside className="min-w-0 lg:col-start-2 lg:row-start-1">
          <OpportunityInfoPanel
            o={o}
            canEdit={editable}
            stages={stages}
            types={types}
            clients={clients}
            users={users}
            teams={teams}
            canViewAll={canViewAll}
            save={save}
          />
        </aside>

        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <TabsBar
            tabs={tabs.map((t) => ({ key: t.key, label: tabLabel(t.label, counts[t.key]) }))}
            activeTab={activeTab}
            onChange={setTab}
            ariaLabel="Opportunity sections"
          />

          {/* Details stays mounted (hidden on other tabs), so a composer the
              header opens is ready and a draft survives switching tabs */}
          {!deleted && (
            <div role="tabpanel" id="tabpanel-details" aria-labelledby="tab-details" hidden={activeTab !== "details"}>
              <Timeline
                ref={timelineRef}
                timelineUrl={`/api/opportunities/${o.id}/timeline`}
                canAddNotes={editable}
                myUserId={myUserId}
                refreshKey={timelineKey}
                buttons={buttons}
                unavailableReason={unavailableReason}
                showButtons={false}
                onComposerChange={setOpenButtonId}
                stages={stages}
                email={{
                  sendUrl: `/api/opportunities/${o.id}/email`,
                  attachmentsUrl: `/api/opportunities/${o.id}/attachments`,
                  options: emailOptions,
                  defaultSubject: defaultEmailSubject(o.number, o.title),
                  defaultTo: o.contact.email ? [o.contact.email] : [],
                }}
                // A note or email that moved the stage changed the opportunity too
                onPosted={(entry) => {
                  if (noteStageChange(entry.data)) {
                    load()
                    notifyOpportunitiesChanged()
                  }
                }}
              />
            </div>
          )}
          {activeTab === "attachments" && (
            <div role="tabpanel" id="tabpanel-attachments" aria-labelledby="tab-attachments">
              <OpportunityAttachments
                opportunityId={o.id}
                canEdit={editable}
                // The tab's count and the timeline both change
                onChanged={() => {
                  setTimelineKey((k) => k + 1)
                  load()
                }}
              />
            </div>
          )}
          {activeTab === "related" && (
            <div role="tabpanel" id="tabpanel-related" aria-labelledby="tab-related">
              <OpportunityRelatedPanel related={related} failed={relatedFailed} linkedCount={linkedCount} />
            </div>
          )}
          {activeTab === "audit" && (
            <div role="tabpanel" id="tabpanel-audit" aria-labelledby="tab-audit">
              <AuditLogTable
                listUrl={`/api/opportunities/${o.id}/audit`}
                filterRowId="opportunity-audit-column-filters"
                // An undo changed the opportunity and its timeline
                onChanged={() => {
                  load()
                  setTimelineKey((k) => k + 1)
                  notifyOpportunitiesChanged()
                }}
              />
            </div>
          )}
        </div>
      </div>

      {showDelete && (
        <DeleteOpportunityDialog opportunity={o} onCancel={() => setShowDelete(false)} onDelete={handleDelete} />
      )}
    </div>
  )
}
