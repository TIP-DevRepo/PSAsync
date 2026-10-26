"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { Timeline, type TimelineHandle } from "@/components/timeline/Timeline"
import { ActionButtonBar } from "@/components/timeline/ActionButtonBar"
import { toast } from "@/lib/toast"
import { promptDialog } from "@/lib/prompt-dialog"
import { OPPORTUNITY_TITLE_MAX } from "@/lib/opportunity-rules"
import { formatDate, type StageOption, type TypeOption } from "@/lib/opportunity-view"
import { OPPORTUNITY_ACTION_BUTTONS } from "@/lib/timeline-buttons"
import { noteStageChange } from "@/lib/timeline-actions"
import { StagePill } from "./StagePill"
import { OpportunityRelatedPanel } from "./OpportunityRelatedPanel"
import { OpportunityAttachments } from "./OpportunityAttachments"
import { DeleteOpportunityDialog } from "./DeleteOpportunityDialog"
import { OpportunityInfoPanel, type OpportunityDetailData } from "./OpportunityInfoPanel"

const breadcrumbItems = [{ label: "Opportunities", href: "/dashboard/opportunities" }]

// Laid out like HaloPSA: the client and number large on the first line, the
// title under it, then the stage pill, created and closed text, and the
// action buttons on one row. The timeline is the main column; the details
// panel (edited in place), attachments, and Related are on the right. At
// phone width the right column comes first, then the timeline.
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
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  // Bumped after every change the server records on the timeline, so the
  // timeline shows its new entry
  const [timelineKey, setTimelineKey] = useState(0)
  // The header's action bar opens the timeline's composer
  const timelineRef = useRef<TimelineHandle>(null)
  const [openButtonId, setOpenButtonId] = useState<string | null>(null)

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
    if (!canEdit) return
    fetch("/api/opportunity-types").then(json).then((data) => Array.isArray(data) && setTypes(data))
    fetch("/api/clients").then(json).then((data) => Array.isArray(data) && setClients(data))
    // Every user's name, for the owner choices (ownerFieldChoices decides who)
    fetch("/api/users").then(json).then((data) => Array.isArray(data) && setUsers(data))
  }, [load, canEdit])

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

  async function handleDelete(): Promise<string | null> {
    const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Opportunity deleted")
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
              {canEdit && (
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
          {canDelete && (
            <Button variant="outline" onClick={() => setShowDelete(true)} className="text-danger hover:text-danger">
              Delete
            </Button>
          )}
        </div>

        {/* The stage pill, created and closed text, and the action buttons on
            one row; the buttons sit on the right and wrap onto their own line
            on narrow screens */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StagePill name={o.stage.name} category={o.stage.category} />
          <p className="text-xs text-muted-foreground">
            Created{o.createdBy ? ` by ${o.createdBy.name}` : ""} on {formatDate(o.createdAt)}
            {o.closedAt ? ` · Closed ${formatDate(o.closedAt)}` : ""}
          </p>
          {canEdit && (
            <div className="w-full md:ml-auto md:w-auto">
              <ActionButtonBar
                buttons={OPPORTUNITY_ACTION_BUTTONS}
                onSelect={(button) => timelineRef.current?.openComposer(button)}
                activeId={openButtonId}
                label="Timeline actions"
              />
            </div>
          )}
        </div>
      </header>

      {/* The right column comes first in the page, so at phone width the
          details lead; from lg up the grid puts the timeline on the left */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
          <OpportunityInfoPanel
            o={o}
            canEdit={canEdit}
            stages={stages}
            types={types}
            clients={clients}
            users={users}
            myUserId={myUserId}
            canViewAll={canViewAll}
            save={save}
          />
          <OpportunityAttachments opportunityId={o.id} canEdit={canEdit} onChanged={() => setTimelineKey((k) => k + 1)} />
          <OpportunityRelatedPanel opportunityId={o.id} linkedCount={linkedCount} />
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <Timeline
            ref={timelineRef}
            timelineUrl={`/api/opportunities/${o.id}/timeline`}
            canAddNotes={canEdit}
            myUserId={myUserId}
            refreshKey={timelineKey}
            buttons={OPPORTUNITY_ACTION_BUTTONS}
            showButtons={false}
            onComposerChange={setOpenButtonId}
            stages={stages}
            // A note that moved the stage changed the opportunity too
            onPosted={(entry) => {
              if (noteStageChange(entry.data)) load()
            }}
          />
        </div>
      </div>

      {showDelete && (
        <DeleteOpportunityDialog opportunity={o} onCancel={() => setShowDelete(false)} onDelete={handleDelete} />
      )}
    </div>
  )
}
