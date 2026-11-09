"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, Columns3, List, Plus, Target, Trophy, UserRound } from "lucide-react"
import { FilterChip } from "@/components/ui/filter-chip"
import { Button } from "@/components/ui/button"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { TopbarAction } from "@/components/layout/TopbarSlots"
import { LIST_PAGE, PageHeader, StatRow, StatTile } from "@/components/ui/blocks"
import { ViewTabs, type ViewTabItem } from "@/components/ui/view-tabs"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { newSalesOrderHref, offersSalesOrderAfterMove, WON_SALES_ORDER_PROMPT } from "@/lib/opportunity-quote-rules"
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  listForStageHref,
  moveOpportunityStage,
  notifyOpportunitiesChanged,
  opportunityApiQuery,
  opportunityStats,
  OWNER_UNASSIGNED,
  opportunityUrlQuery,
  readOpportunityUrl,
  type OpportunityFilters,
  type OpportunityRow,
  type OpportunityView,
  type StageOption,
  type StageSaveResult,
  type TypeOption,
} from "@/lib/opportunity-view"
import { OpportunityFilterBar } from "./OpportunityFilterBar"
import { OpportunityBoard } from "./OpportunityBoard"
import { OpportunityList } from "./OpportunityList"
import { NewOpportunityModal } from "./NewOpportunityModal"
import type { TeamSummary } from "@/lib/team-rules"

const VIEWS: ViewTabItem<OpportunityView>[] = [
  { key: "board", label: "Board", icon: <Columns3 size={15} aria-hidden="true" /> },
  { key: "list", label: "List", icon: <List size={15} aria-hidden="true" /> },
]

export function OpportunitiesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useAccess()
  const canCreate = can("opportunities.create")
  const canEdit = can("opportunities.edit")

  // The view and filters are read from the URL on every render, so a
  // refresh or a shared link opens exactly the same page
  const { view, filters } = useMemo(() => readOpportunityUrl(searchParams), [searchParams])
  const apiQuery = opportunityApiQuery(filters)

  const [stages, setStages] = useState<StageOption[]>([])
  const [types, setTypes] = useState<TypeOption[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [users, setUsers] = useState<{ id: string; name: string; active: boolean }[]>([])
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([])
  // The API query the list on screen came from; loading until it matches
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const loading = loadedQuery !== apiQuery
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const setUrl = useCallback(
    (nextView: OpportunityView, nextFilters: OpportunityFilters) => {
      router.replace(`${pathname}${opportunityUrlQuery(nextView, nextFilters)}`, { scroll: false })
    },
    [router, pathname]
  )
  // The search, team, and owner keep the list's column filters (f_<column>) in the URL
  const setFilters = useCallback(
    (next: OpportunityFilters) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.q.trim()) params.set("q", next.q.trim())
      else params.delete("q")
      if (next.team) params.set("team", next.team)
      else params.delete("team")
      if (next.owner) params.set("owner", next.owner)
      else params.delete("owner")
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams]
  )
  const setSearch = useCallback((q: string) => setFilters({ ...filters, q }), [setFilters, filters])

  useEffect(() => {
    const json = (res: Response) => (res.ok ? res.json() : [])
    fetch("/api/opportunity-stages").then(json).then((data) => Array.isArray(data) && setStages(data))
    fetch("/api/opportunity-types").then(json).then((data) => Array.isArray(data) && setTypes(data))
    fetch("/api/clients").then(json).then((data) => Array.isArray(data) && setClients(data))
    fetch("/api/teams").then(json).then((data) => Array.isArray(data) && setTeams(data))
    fetch("/api/users").then(json).then((data) => Array.isArray(data) && setUsers(data))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/opportunities${apiQuery}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok || !Array.isArray(data)) {
          setOpportunities([])
          setLoadError((data && typeof data.error === "string" && data.error) || "Couldn't load opportunities.")
        } else {
          setOpportunities(data)
          setLoadError(null)
        }
        setLoadedQuery(apiQuery)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setLoadError("Couldn't load opportunities.")
        setLoadedQuery(apiQuery)
      })
    return () => controller.abort()
  }, [apiQuery])

  async function saveStage(id: string, stageId: string): Promise<StageSaveResult<OpportunityRow>> {
    const res = await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId }),
    })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, opportunity: data as OpportunityRow } : { ok: false, error: data.error }
  }

  async function handleMove(card: OpportunityRow, stage: StageOption) {
    const result = await moveOpportunityStage({ card, stage, now: new Date(), update: setOpportunities, save: saveStage })
    if (!result.ok) {
      toast.error(`Couldn't move ${card.number} to ${stage.name}`, result.error)
      return
    }
    // The sidebar counts open opportunities, so a move in or out of Won or Lost changes them
    notifyOpportunitiesChanged()
    // Dragged into a WON stage with no linked quote: offer a sales order
    const canCreateSalesOrders = can("pages.salesOrders") && can("salesOrders.create")
    if (offersSalesOrderAfterMove({ from: card.stage.category, to: stage.category, hasLinkedQuote: card.quoteValue !== null, canCreateSalesOrders })) {
      const create = await confirmDialog(WON_SALES_ORDER_PROMPT)
      if (create) router.push(newSalesOrderHref(card.id))
    }
  }

  const filtered = hasActiveFilters(filters)
  // Names for the breadcrumb, the page line, and the owner chip (a stand in
  // until the lists load)
  const teamChipName = filters.team ? (teams.find((t) => t.id === filters.team)?.name ?? "Team") : null
  const ownerChipName = !filters.owner
    ? null
    : filters.owner === OWNER_UNASSIGNED
      ? "Unassigned"
      : (users.find((u) => u.id === filters.owner)?.name ?? "Owner")

  // The stat tiles, from the rows already on screen (no extra request)
  const stats = opportunityStats(opportunities, new Date())
  const showStats = !loadError && !(loading && opportunities.length === 0)
  const scope = teamChipName ? `${teamChipName}${ownerChipName ? `, ${ownerChipName}` : ""}` : ownerChipName

  return (
    <div className={LIST_PAGE}>
      <Breadcrumbs items={teamChipName ? [{ label: "Opportunities", href: pathname }] : []} current={teamChipName ?? "Opportunities"} />
      {canCreate && (
        <TopbarAction>
          <Button size="lg" className="gap-1.5 px-3.5" onClick={() => setShowNew(true)}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            New opportunity
          </Button>
        </TopbarAction>
      )}
      <PageHeader
        title="Opportunities"
        subtitle={showStats ? `${scope ? `${scope} · ` : ""}${stats.open} open, ${stats.unassigned} unassigned` : scope ?? "Every deal you can open, from first conversation to won or lost."}
      />

      {showStats && (
        <StatRow label="Opportunity totals">
          <StatTile label="Open" value={stats.open} icon={Target} tone="accent" />
          <StatTile label="Unassigned" value={stats.unassigned} icon={UserRound} tone="neutral" />
          <StatTile label="Closing this month" value={stats.closingThisMonth} icon={CalendarClock} tone="warn" />
          <StatTile label="Won this month" value={stats.wonThisMonth} icon={Trophy} tone="ok" />
        </StatRow>
      )}

      {/* The design's toolbar: the view switch, then the search and the
          owner chip on the right */}
      <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border bg-card px-3.5 py-3">
        <ViewTabs
          ariaLabel="View"
          views={VIEWS}
          active={view}
          // Changing view keeps the search; the list's column filters only
          // belong to the list
          onChange={(key) => setUrl(key, filters)}
        />
        <span className="flex-1" />
        {ownerChipName && <FilterChip label={`Owner: ${ownerChipName}`} onRemove={() => setFilters({ ...filters, owner: "" })} />}
        <OpportunityFilterBar q={filters.q} onChange={setSearch} />
      </div>

      {loadError ? (
        <div role="alert" className="rounded-panel border border-border bg-card p-6 text-center">
          <p className="text-sm font-medium text-foreground">{loadError}</p>
          {filtered && (
            <Button variant="outline" className="mt-3" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      ) : loading && opportunities.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : opportunities.length === 0 ? (
        <EmptyState filtered={filtered} canCreate={canCreate} onCreate={() => setShowNew(true)} onClear={() => setFilters(EMPTY_FILTERS)} />
      ) : view === "board" ? (
        <OpportunityBoard
          stages={stages}
          opportunities={opportunities}
          canEdit={canEdit}
          onMove={handleMove}
          // "N older, view in list": the list with that stage in its Stage column filter
          listHref={(stageId) => listForStageHref(pathname, filters, stages.find((st) => st.id === stageId)?.name ?? "")}
        />
      ) : (
        <OpportunityList opportunities={opportunities} stages={stages} />
      )}

      {showNew && (
        <NewOpportunityModal
          stages={stages}
          types={types}
          clients={clients}
          teams={teams}
          users={users}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            notifyOpportunitiesChanged()
            router.push(`/dashboard/opportunities/${id}`)
          }}
        />
      )}
    </div>
  )
}

function EmptyState({
  filtered,
  canCreate,
  onCreate,
  onClear,
}: {
  filtered: boolean
  canCreate: boolean
  onCreate: () => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-border bg-card px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-acc-tint text-acc-ink">
        <Target size={20} aria-hidden="true" />
      </span>
      {filtered ? (
        <>
          <p className="text-base font-semibold text-foreground">No opportunities match this search</p>
          <p className="max-w-md text-sm text-muted-foreground">Try other search words, or clear the search to see everything you can open.</p>
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-foreground">No opportunities yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Opportunities track a deal from the first conversation to won or lost. {canCreate ? "Add one to start your pipeline." : "Ones you can open will show here."}
          </p>
          {canCreate && (
            <Button onClick={onCreate} className="gap-1">
              <Plus size={14} aria-hidden="true" />
              New opportunity
            </Button>
          )}
        </>
      )}
    </div>
  )
}
