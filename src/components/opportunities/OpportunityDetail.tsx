"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Briefcase, MoreHorizontal, Pencil } from "lucide-react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { Timeline, type TimelineHandle } from "@/components/timeline/Timeline"
import { emailUnavailableReason, type EmailOptions } from "@/components/timeline/EmailComposer"
import { ActionButtonBar } from "@/components/timeline/ActionButtonBar"
import { TabsBar } from "@/components/ui/tabs-bar"
import { RecordHeaderCard } from "@/components/ui/blocks"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { opportunityDisplayValue } from "@/lib/opportunity-value"
import { AuditLogTable } from "@/components/audit/AuditLogTable"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { OPPORTUNITY_TITLE_MAX } from "@/lib/opportunity-rules"
import { formatCents, formatDate, formatDateOnly, notifyOpportunitiesChanged, opportunityFolderHref, valueCents, type StageOption, type TypeOption } from "@/lib/opportunity-view"
import type { TeamSummary } from "@/lib/team-rules"
import type { ActionButtonDefinition } from "@/lib/timeline-buttons"
import { opportunityTabHref, readOpportunityTab, visibleOpportunityTabs, type OpportunityTabKey } from "@/lib/opportunity-tabs"
import { noteStageChange } from "@/lib/timeline-actions"
import { defaultEmailSubject } from "@/lib/record-email"
import { newSalesOrderHref, offersSalesOrderAfterMove, raiseQuoteHref, WON_SALES_ORDER_PROMPT, type StageCategoryName } from "@/lib/opportunity-quote-rules"
import { StagePill } from "./StagePill"
import { OpportunityRelatedPanel, relatedCount, useOpportunityRelated } from "./OpportunityRelatedPanel"
import { OpportunityAttachments } from "./OpportunityAttachments"
import { DeleteOpportunityDialog } from "./DeleteOpportunityDialog"
import { OpportunityInfoPanel, type OpportunityDetailData } from "./OpportunityInfoPanel"

const breadcrumbItems = [{ label: "Opportunities", href: "/dashboard/opportunities" }]

const NEEDS_EDIT_MESSAGE = "You need edit access to use this"
const DELETED_MESSAGE = "This opportunity is deleted"
const NEEDS_QUOTE_CREATE_MESSAGE = "You need permission to create quotes to use this"
const CLOSED_FOR_QUOTES_MESSAGE = "Quotes can only be raised on an open opportunity"

// Laid out as the design draws a record (RecordHeaderCard): the icon tile,
// the client and number large on the first line, the title under it, the
// stage pill and a More actions menu (Delete) on the right, the action
// buttons on their own row, then a summary strip (value, close date, team,
// created by). The main column is tabs (src/lib/opportunity-
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
  const canCreateSalesOrders = can("pages.salesOrders") && can("salesOrders.create")

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
  // Raise Quote also needs quotes.create, and an OPEN opportunity (a quote
  // only links to an open one).
  const stageCategory = opportunity?.stage.category ?? null
  const unavailableReason = useCallback(
    (button: ActionButtonDefinition): string | null => {
      if (deleted) return DELETED_MESSAGE
      if (!canEdit) return NEEDS_EDIT_MESSAGE
      if (button.opens.kind === "quote") {
        if (!can("pages.quotes") || !can("quotes.create")) return NEEDS_QUOTE_CREATE_MESSAGE
        return stageCategory === "OPEN" ? null : CLOSED_FOR_QUOTES_MESSAGE
      }
      return button.opens.kind === "email" ? emailUnavailableReason(emailOptions) : null
    },
    [canEdit, deleted, emailOptions, can, stageCategory]
  )

  // After a user moves it into a WON stage, an opportunity with no linked
  // quote offers a sales order (never made automatically)
  const offerSalesOrder = useCallback(
    async (from: StageCategoryName | undefined, to: StageCategoryName | undefined, hasLinkedQuote: boolean) => {
      if (!from || !to || !offersSalesOrderAfterMove({ from, to, hasLinkedQuote, canCreateSalesOrders })) return
      const create = await confirmDialog(WON_SALES_ORDER_PROMPT)
      if (create) router.push(newSalesOrderHref(id))
    },
    [canCreateSalesOrders, id, router]
  )

  // A header button opens the composer at the top of the timeline, on the
  // Details tab. Raise Quote opens the New Quote form (through the template
  // picker) with this opportunity's client, contact, and link.
  function openFromHeader(button: ActionButtonDefinition) {
    if (unavailableReason(button)) return
    if (button.opens.kind === "quote") {
      router.push(raiseQuoteHref(id))
      return
    }
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
    const before = opportunity
    setOpportunity(data)
    setTimelineKey((k) => k + 1)
    // The sidebar counts open opportunities by team and owner
    if ("stageId" in patch || "ownerId" in patch || "teamId" in patch) notifyOpportunitiesChanged()
    if ("stageId" in patch && before) offerSalesOrder(before.stage.category, data.stage?.category, data._count?.quotes > 0)
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

  // The latest linked quote's total, else the expected value
  const shownValue = opportunityDisplayValue(o)
  const summary = [
    { label: "Value", value: shownValue === null ? "-" : formatCents(valueCents(shownValue)) },
    { label: "Close", value: formatDateOnly(o.expectedCloseDate) },
    { label: "Team", value: o.team?.name ?? "-" },
    { value: `Created${o.createdBy ? ` by ${o.createdBy.name}` : ""} on ${formatDate(o.createdAt)}${o.closedAt ? ` · Closed ${formatDate(o.closedAt)}` : ""}` },
  ]
  const showMenu = canDelete && !deleted

  return (
    <div className="flex w-full max-w-[1320px] flex-col gap-5">
      <Breadcrumbs
        items={[...breadcrumbItems, ...(o.team ? [{ label: o.team.name, href: opportunityFolderHref(o.team.id) }] : [])]}
        current={o.number}
      />
      <RecordHeaderCard
        icon={Briefcase}
        // Who the deal is with, and its number
        title={
          <Link href={`/dashboard/clients/${o.client.id}`} className="rounded-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {o.client.name}
          </Link>
        }
        number={o.number}
        subtitle={
          <p className="flex items-start gap-2">
            <span className="break-words">{o.title}</span>
            {editable && (
              <button
                type="button"
                onClick={() => editTitle(o.title)}
                disabled={saving}
                aria-label="Rename opportunity"
                className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            )}
          </p>
        }
        side={
          <>
            <StagePill name={o.stage.name} category={o.stage.category} className="py-1" />
            {showMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More actions"
                    className="flex h-9 w-9 items-center justify-center rounded-control border border-border bg-card text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowDelete(true)} className="text-danger focus:text-danger">
                    Delete opportunity
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        // The action buttons on their own row; they wrap at narrow widths
        actions={
          <ActionButtonBar buttons={buttons} onSelect={openFromHeader} activeId={openButtonId} unavailableReason={unavailableReason} label="Timeline actions" />
        }
        summary={summary}
      >
        {o.deletedAt && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-bad-tint px-4 py-3 text-sm text-bad">
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
      </RecordHeaderCard>

      {/* The panel comes first in the page, so at phone width it leads;
          from lg up the grid puts the tabs on the left */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
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

        <div className="min-w-0 space-y-3.5 lg:col-start-1 lg:row-start-1">
          <TabsBar
            tabs={tabs.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ? counts[t.key] : undefined }))}
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
                  const moved = noteStageChange(entry.data)
                  if (moved) {
                    load()
                    notifyOpportunitiesChanged()
                    offerSalesOrder(moved.from.category as StageCategoryName | undefined, moved.to.category as StageCategoryName | undefined, o._count.quotes > 0)
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
              <OpportunityRelatedPanel related={related} failed={relatedFailed} linkedCount={linkedCount} opportunityId={o.id} />
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
