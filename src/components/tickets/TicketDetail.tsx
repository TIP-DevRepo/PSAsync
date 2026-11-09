"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Link2, MoreHorizontal, Pencil, Ticket } from "lucide-react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { useAccess } from "@/components/AccessProvider"
import { Timeline, type TimelineHandle, type TimelineMoveConfig } from "@/components/timeline/Timeline"
import { emailUnavailableReason, type EmailOptions } from "@/components/timeline/EmailComposer"
import { ActionButtonBar } from "@/components/timeline/ActionButtonBar"
import { TabsBar } from "@/components/ui/tabs-bar"
import { Card, RECORD_LAYOUT, RecordHeaderCard } from "@/components/ui/blocks"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AuditLogTable } from "@/components/audit/AuditLogTable"
import { RecordAttachments } from "@/components/attachments/RecordAttachments"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { formatDate } from "@/lib/opportunity-view"
import { clientPageHref } from "@/lib/client-links"
import { defaultEmailSubject } from "@/lib/record-email"
import { noteStatusChange } from "@/lib/timeline-actions"
import { TEAM_CHANGE_ASSIGNEE_MESSAGE, TICKET_CATEGORY_LABELS, TICKET_TITLE_MAX } from "@/lib/ticket-rules"
import { ticketFolderHref } from "@/lib/ticket-list"
import { notifyTicketsChanged, SOURCE_LABELS } from "@/lib/ticket-view"
import { readTicketTab, ticketTabHref, visibleTicketTabs, type TicketTabKey } from "@/lib/ticket-tabs"
import type { ActionButtonDefinition } from "@/lib/timeline-buttons"
import { TicketInfoPanel, type TicketDetailData } from "./TicketInfoPanel"
import { TicketPriorityPill, TicketStatusPill } from "./TicketPills"
import { useTicketOptions } from "./useTicketOptions"

const breadcrumbItems = [{ label: "Tickets", href: "/dashboard/tickets" }]
const NEEDS_EDIT_MESSAGE = "You need edit access to use this"

// A note or email on a ticket moves its status, grouped by category and
// tinted the way the status pills are
export const TICKET_STATUS_MOVES: TimelineMoveConfig = {
  field: "statusId",
  noun: "status",
  groups: [
    { category: "OPEN", label: TICKET_CATEGORY_LABELS.OPEN, tone: "accent" },
    { category: "WAITING", label: TICKET_CATEGORY_LABELS.WAITING, tone: "warn" },
    { category: "RESOLVED", label: TICKET_CATEGORY_LABELS.RESOLVED, tone: "ok" },
    { category: "CLOSED", label: TICKET_CATEGORY_LABELS.CLOSED, tone: "neutral" },
  ],
}

// The ticket page (/dashboard/tickets/[id]), laid out like the opportunity
// page (the design's record view): RecordHeaderCard with the icon tile, the
// client (or "No client") and the number large, the title under it, the
// status and priority pills and a More actions menu (Delete) on the right,
// the ticket's action buttons as pills, and a summary strip (queue,
// assignee, type, source, created by and date, resolved or closed). The
// main column is tabs kept in ?tab= (src/lib/ticket-tabs.ts): Details (the
// timeline, whose composer can move the status), Attachments, Related, and
// the Audit log (auditLog.view). The info cards on the right edit in place.
// Without tickets.edit everything is read only and the action buttons are
// dimmed with the reason. A ticket the user may not open, and a deleted
// one, is the API's 404, shown as not found.
export function TicketDetail({ id }: { id: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { access, can } = useAccess()
  const myUserId = access?.userId ?? null
  const canEdit = can("tickets.edit")
  const canDelete = can("tickets.delete")
  const options = useTicketOptions()

  const [ticket, setTicket] = useState<TicketDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [timelineKey, setTimelineKey] = useState(0)
  const timelineRef = useRef<TimelineHandle>(null)
  const [openButtonId, setOpenButtonId] = useState<string | null>(null)
  const [buttons, setButtons] = useState<ActionButtonDefinition[]>([])
  const [emailOptions, setEmailOptions] = useState<EmailOptions | null>(null)
  const hasEmailButton = buttons.some((b) => b.opens.kind === "email")

  const tabs = visibleTicketTabs(can)
  const urlTab = readTicketTab(searchParams, tabs)
  const [tab, setTabState] = useState<TicketTabKey>(urlTab)
  const [seenUrlTab, setSeenUrlTab] = useState<TicketTabKey>(urlTab)
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab)
    setTabState(urlTab)
  }
  function setTab(key: TicketTabKey) {
    setTabState(key)
    router.replace(ticketTabHref(pathname, searchParams.toString(), key), { scroll: false })
  }

  const unavailableReason = useCallback(
    (button: ActionButtonDefinition): string | null => {
      if (!canEdit) return NEEDS_EDIT_MESSAGE
      return button.opens.kind === "email" ? emailUnavailableReason(emailOptions) : null
    },
    [canEdit, emailOptions]
  )

  function openFromHeader(button: ActionButtonDefinition) {
    if (unavailableReason(button)) return
    if (tab !== "details") setTab("details")
    timelineRef.current?.openComposer(button)
  }

  const load = useCallback(() => {
    fetch(`/api/tickets/${id}`)
      .then((res) => {
        if (!res.ok) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setTicket(data)
        setLoading(false)
      })
      .catch(() => {
        setNotFound(true)
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    load()
    fetch("/api/action-buttons?for=ticket")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => Array.isArray(data) && setButtons(data))
      .catch(() => undefined)
  }, [load])

  useEffect(() => {
    if (!canEdit || !hasEmailButton) return
    fetch(`/api/tickets/${id}/email-options`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EmailOptions | null) => data && setEmailOptions(data))
      .catch(() => undefined)
  }, [id, canEdit, hasEmailButton])

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    return { ok: !!res?.ok, data }
  }

  function applySaved(data: TicketDetailData, body: Record<string, unknown>) {
    setTicket(data)
    setTimelineKey((k) => k + 1)
    if ("statusId" in body || "assigneeId" in body || "teamId" in body) notifyTicketsChanged()
  }

  // Saves only the fields given; a refusal keeps the old value and says why
  async function save(body: Record<string, unknown>, what: string): Promise<boolean> {
    setSaving(true)
    const { ok, data } = await patch(body)
    setSaving(false)
    if (!ok) {
      toast.error(`Couldn't save the ${what}`, typeof data.error === "string" ? data.error : "Try again.")
      return false
    }
    applySaved(data as TicketDetailData, body)
    return true
  }

  // A new queue whose members don't include the assignee: the server asks
  // for a new assignee or none, so it is saved unassigned and says so
  async function saveTeam(teamId: string): Promise<boolean> {
    if (teamId === ticket?.team.id) return true
    setSaving(true)
    const first = await patch({ teamId })
    const retry = !first.ok && first.data.error === TEAM_CHANGE_ASSIGNEE_MESSAGE
    const { ok, data } = retry ? await patch({ teamId, assigneeId: null }) : first
    const cleared = retry && ok
    setSaving(false)
    if (!ok) {
      toast.error("Couldn't save the queue", typeof data.error === "string" ? data.error : "Try again.")
      return false
    }
    applySaved(data as TicketDetailData, { teamId })
    if (cleared) toast.success("Queue changed", "The assignee is not in the new queue, so the ticket is now unassigned.")
    return true
  }

  async function editTitle(current: string) {
    const title = await promptDialog({ title: "Rename ticket", defaultValue: current, confirmLabel: "Save" })
    if (title === null || title === current) return
    if (title.length > TICKET_TITLE_MAX) {
      toast.error("Couldn't save the title", `Title must be ${TICKET_TITLE_MAX} characters or fewer`)
      return
    }
    save({ title }, "title")
  }

  async function handleDelete() {
    if (!ticket) return
    const ok = await confirmDialog({
      title: `Delete ${ticket.number}?`,
      description: `"${ticket.title}" and its attachments will be deleted. Admins with audit log access can restore it.`,
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!ok) return
    const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" }).catch(() => null)
    if (!res?.ok) {
      const data = res ? await res.json().catch(() => ({})) : {}
      toast.error("Couldn't delete this ticket", typeof data.error === "string" ? data.error : "Try again.")
      return
    }
    toast.success("Ticket deleted")
    notifyTicketsChanged()
    router.push("/dashboard/tickets")
  }

  if (loading) {
    return (
      <div className="w-full">
        <Breadcrumbs items={breadcrumbItems} current={null} />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }
  if (notFound || !ticket) {
    return (
      <div className="w-full">
        <Breadcrumbs items={breadcrumbItems} current="Not found" />
        <p className="text-sm text-muted-foreground">This ticket was not found, or you do not have access to it.</p>
      </div>
    )
  }

  const t = ticket
  const priorityOrders = (options.priorities.some((p) => p.id === t.priority.id) ? options.priorities : [t.priority, ...options.priorities]).map((p) => p.sortOrder)
  const counts: Partial<Record<TicketTabKey, number>> = { attachments: t._count.attachments }
  const summary = [
    { label: "Queue", value: t.team.name },
    { label: "Assignee", value: t.assignee?.name ?? "Unassigned" },
    { label: "Type", value: t.type.name },
    { label: "Source", value: SOURCE_LABELS[t.source] },
    {
      value: `Created${t.createdBy ? ` by ${t.createdBy.name}` : ""} on ${formatDate(t.createdAt)}${
        t.closedAt ? ` · Closed ${formatDate(t.closedAt)}` : t.resolvedAt ? ` · Resolved ${formatDate(t.resolvedAt)}` : ""
      }`,
    },
  ]

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <Breadcrumbs items={[...breadcrumbItems, { label: t.team.name, href: ticketFolderHref(t.team.id) }]} current={t.number} />
      <RecordHeaderCard
        icon={Ticket}
        title={
          t.client ? (
            <Link href={clientPageHref(t.client.id)} className="rounded-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t.client.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">No client</span>
          )
        }
        number={t.number}
        subtitle={
          <p className="flex items-start gap-2">
            <span className="break-words">{t.title}</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => editTitle(t.title)}
                disabled={saving}
                aria-label="Rename ticket"
                className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            )}
          </p>
        }
        side={
          <>
            <TicketStatusPill name={t.status.name} category={t.status.category} className="py-1" />
            <TicketPriorityPill name={t.priority.name} sortOrder={t.priority.sortOrder} allOrders={priorityOrders} />
            {canDelete && (
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
                  <DropdownMenuItem onClick={handleDelete} className="text-danger focus:text-danger">
                    Delete ticket
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        actions={<ActionButtonBar buttons={buttons} onSelect={openFromHeader} activeId={openButtonId} unavailableReason={unavailableReason} label="Timeline actions" />}
        summary={summary}
      />

      {/* The panel comes first, so at phone width it leads; from lg up the
          grid puts the tabs on the left */}
      <div className={RECORD_LAYOUT}>
        <aside className="min-w-0 lg:col-start-2 lg:row-start-1">
          <TicketInfoPanel
            t={t}
            canEdit={canEdit}
            teams={options.teams}
            users={options.users}
            types={options.types}
            priorities={options.priorities}
            statuses={options.statuses}
            clients={options.clients}
            canAssign={can("tickets.assign")}
            canViewAll={can("tickets.viewAll")}
            save={save}
            saveTeam={saveTeam}
          />
        </aside>

        <div className="min-w-0 space-y-3.5 lg:col-start-1 lg:row-start-1">
          <TabsBar
            tabs={tabs.map((x) => ({ key: x.key, label: x.label, count: counts[x.key] ? counts[x.key] : undefined }))}
            activeTab={tab}
            onChange={setTab}
            ariaLabel="Ticket sections"
          />

          {/* Details stays mounted (hidden on other tabs), so a composer the
              header opens is ready and a draft survives switching tabs */}
          <div role="tabpanel" id="tabpanel-details" aria-labelledby="tab-details" hidden={tab !== "details"}>
            <Timeline
              ref={timelineRef}
              timelineUrl={`/api/tickets/${t.id}/timeline`}
              canAddNotes={canEdit}
              myUserId={myUserId}
              refreshKey={timelineKey}
              buttons={buttons}
              unavailableReason={unavailableReason}
              showButtons={false}
              onComposerChange={setOpenButtonId}
              stages={options.statuses}
              moves={TICKET_STATUS_MOVES}
              email={{
                sendUrl: `/api/tickets/${t.id}/email`,
                attachmentsUrl: `/api/tickets/${t.id}/attachments`,
                options: emailOptions,
                defaultSubject: defaultEmailSubject(t.number, t.title),
                defaultTo: t.contact?.email ? [t.contact.email] : [],
              }}
              // A note or email that moved the status changed the ticket too
              onPosted={(entry) => {
                if (noteStatusChange(entry.data)) {
                  load()
                  notifyTicketsChanged()
                }
              }}
            />
          </div>
          {tab === "attachments" && (
            <div role="tabpanel" id="tabpanel-attachments" aria-labelledby="tab-attachments">
              <RecordAttachments
                attachmentsUrl={`/api/tickets/${t.id}/attachments`}
                recordNoun="ticket"
                canEdit={canEdit}
                onChanged={() => {
                  setTimelineKey((k) => k + 1)
                  load()
                }}
              />
            </div>
          )}
          {tab === "related" && (
            <div role="tabpanel" id="tabpanel-related" aria-labelledby="tab-related">
              <Card size="card" className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-neu-tint text-muted-foreground">
                  <Link2 size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">Related records</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Links to opportunities, quotes, and assets come in a later update.</p>
                </div>
              </Card>
            </div>
          )}
          {tab === "audit" && (
            <div role="tabpanel" id="tabpanel-audit" aria-labelledby="tab-audit">
              <AuditLogTable
                listUrl={`/api/tickets/${t.id}/audit`}
                filterRowId="ticket-audit-column-filters"
                // An undo changed the ticket and its timeline
                onChanged={() => {
                  load()
                  setTimelineKey((k) => k + 1)
                  notifyTicketsChanged()
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
