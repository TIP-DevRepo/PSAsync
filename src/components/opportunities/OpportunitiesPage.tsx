"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Columns3, List, Plus, Target, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAccess } from "@/components/AccessProvider"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  listForStageHref,
  moveOpportunityStage,
  notifyOpportunitiesChanged,
  opportunityApiQuery,
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

const VIEWS: { key: OpportunityView; label: string; icon: typeof List }[] = [
  { key: "board", label: "Board", icon: Columns3 },
  { key: "list", label: "List", icon: List },
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
    if (!result.ok) toast.error(`Couldn't move ${card.number} to ${stage.name}`, result.error)
    // The sidebar counts open opportunities, so a move in or out of Won or Lost changes them
    else notifyOpportunitiesChanged()
  }

  const filtered = hasActiveFilters(filters)
  // Names for the team and owner chips (the id itself until the lists load)
  const teamChipName = filters.team ? (teams.find((t) => t.id === filters.team)?.name ?? "Team") : null
  const ownerChipName = !filters.owner
    ? null
    : filters.owner === OWNER_UNASSIGNED
      ? "Unassigned"
      : (users.find((u) => u.id === filters.owner)?.name ?? "Owner")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display font-semibold tracking-tight text-foreground">Opportunities</h1>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="View" className="inline-flex rounded-md border border-border bg-card p-0.5">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                // Changing view keeps the search; the list's column filters
                // only belong to the list
                onClick={() => setUrl(key, filters)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                )}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {canCreate && (
            <Button onClick={() => setShowNew(true)} className="gap-1">
              <Plus size={14} aria-hidden="true" />
              New opportunity
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <OpportunityFilterBar q={filters.q} onChange={setSearch} />
        {teamChipName && (
          <FilterChip label={`Team: ${teamChipName}`} onRemove={() => setFilters({ ...filters, team: "", owner: "" })} />
        )}
        {ownerChipName && <FilterChip label={`Owner: ${ownerChipName}`} onRemove={() => setFilters({ ...filters, owner: "" })} />}
      </div>

      {loadError ? (
        <div role="alert" className="rounded-lg border border-border bg-card p-6 text-center shadow-card">
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
          initialTeamId={filters.team}
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

// An active team or owner filter next to Search, removed with its X
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-primary-500/10 py-1 pl-3 pr-1 text-sm font-medium text-brand-primary-500">
      <span className="truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-brand-primary-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </span>
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
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
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
