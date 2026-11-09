"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { NAV_ROW, NavIcon, navRowState } from "./sidebar"
import { OPPORTUNITIES_CHANGED_EVENT, opportunityFolderHref, OWNER_UNASSIGNED } from "@/lib/opportunity-view"
import type { SidebarCounts } from "@/lib/team-rules"

// Whether the folder is open, kept per browser. Storage can be missing or
// refuse access (a private window, blocked site data), so every read and
// write is wrapped and the folder simply starts closed.
const OPEN_KEY = "psasync.sidebar.opportunitiesOpen"
const OPEN_CHANGED = "psasync:sidebar-opportunities-open"

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1"
  } catch {
    return false
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0")
  } catch {
    // Not remembered; the folder still opens and closes for this page
  }
  window.dispatchEvent(new Event(OPEN_CHANGED))
}

function subscribeOpen(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(OPEN_CHANGED, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(OPEN_CHANGED, onChange)
  }
}

// The folder rows, as the design draws a sidebar folder: smaller rows under
// a thin line, each count in the muted sidebar text
const ROW =
  "flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[13px] text-sb-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
const ROW_IDLE = "hover:bg-sb-hover"
const ROW_CURRENT = "bg-sb-hover font-semibold"
const CHEVRON_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sb-muted hover:bg-sb-hover hover:text-sb-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"

function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  return (
    <span className="ml-auto shrink-0 text-xs tabular-nums text-sb-muted" aria-label={`${value} open`}>
      {value}
    </span>
  )
}

// The sidebar's Opportunities entry as an expandable folder (HaloPSA style):
// the entry itself opens the board, and its chevron shows "All
// opportunities", then each team in order, each expanding to Unassigned and
// its members, every row with its count of OPEN opportunities the user can
// see (GET /api/opportunities/sidebar-counts, one request for the whole
// folder). A team opens the board filtered to it, a member to that team and
// owner, Unassigned to that team's unassigned ones. Counts reload when the
// folder opens, when the window regains focus, and when a page reports a
// change (notifyOpportunitiesChanged). The entry's badge is the total open
// count from the same request, so the counts also load (once) while the
// folder is closed. The mobile menu shows the same folder; the sidebar has
// no collapsed mode.
export function OpportunitiesFolder({ isActive }: { isActive: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false)
  const [counts, setCounts] = useState<SidebarCounts | null>(null)
  // Teams opened or closed in this page view; the team the board is
  // filtered to starts open
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map())

  const onBoard = pathname === "/dashboard/opportunities"
  const currentTeam = onBoard ? (searchParams.get("team") ?? "") : ""
  const currentOwner = onBoard ? (searchParams.get("owner") ?? "") : ""

  const load = useCallback(() => {
    fetch("/api/opportunities/sidebar-counts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SidebarCounts | null) => {
        if (data && Array.isArray(data.teams)) setCounts(data)
      })
      .catch(() => {
        // Keep the last counts; the next focus or change tries again
      })
  }, [])

  // Once for the badge, again whenever the folder opens; while open, also on
  // focus. A reported change always reloads, since the badge shows it.
  useEffect(() => {
    load()
    window.addEventListener(OPPORTUNITIES_CHANGED_EVENT, load)
    return () => window.removeEventListener(OPPORTUNITIES_CHANGED_EVENT, load)
  }, [load])
  useEffect(() => {
    if (!open) return
    load()
    window.addEventListener("focus", load)
    return () => window.removeEventListener("focus", load)
  }, [open, load])

  const isExpanded = (teamId: string) => expanded.get(teamId) ?? teamId === currentTeam
  function toggleTeam(teamId: string) {
    const next = !isExpanded(teamId)
    setExpanded((prev) => new Map(prev).set(teamId, next))
  }

  const rowClass = (current: boolean) => cn(ROW, current ? ROW_CURRENT : ROW_IDLE)

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link href="/dashboard/opportunities" aria-current={isActive ? "page" : undefined} className={cn(NAV_ROW, "flex-1", navRowState(isActive))}>
          <NavIcon name="opp" />
          <span className="min-w-0 flex-1 truncate">Opportunities</span>
          {counts && (
            <span
              aria-label={`${counts.total} open`}
              className="min-w-5 rounded-full bg-sb-badge px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-sb-badge-text"
            >
              {counts.total}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => writeOpen(!open)}
          aria-expanded={open}
          aria-controls="sidebar-opportunities-folder"
          aria-label={open ? "Hide opportunity teams" : "Show opportunity teams"}
          className={CHEVRON_BUTTON}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform duration-200 ease-out", open && "rotate-90")} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <ul id="sidebar-opportunities-folder" className="mb-1.5 ml-5 mt-0.5 space-y-0.5 border-l border-sb-border pl-2.5">
          <li>
            <Link href={opportunityFolderHref()} className={rowClass(onBoard && !currentTeam && !currentOwner)}>
              <span className="truncate">All opportunities</span>
              <Count value={counts?.total} />
            </Link>
          </li>
          {counts === null && <li className="px-2.5 py-1.5 text-xs text-sb-muted">Loading...</li>}
          {counts?.teams.map((team) => {
            const teamOpen = isExpanded(team.id)
            const groupId = `sidebar-team-${team.id}`
            return (
              <li key={team.id}>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => toggleTeam(team.id)}
                    aria-expanded={teamOpen}
                    aria-controls={groupId}
                    aria-label={`${teamOpen ? "Hide" : "Show"} ${team.name} members`}
                    className={CHEVRON_BUTTON}
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200 ease-out", teamOpen && "rotate-90")} aria-hidden="true" />
                  </button>
                  <Link href={opportunityFolderHref(team.id)} className={rowClass(currentTeam === team.id && !currentOwner)}>
                    <span className="truncate" title={team.name}>
                      {team.name}
                    </span>
                    <Count value={team.count} />
                  </Link>
                </div>
                {teamOpen && (
                  <ul id={groupId} className="ml-7 space-y-0.5">
                    <li>
                      <Link href={opportunityFolderHref(team.id, OWNER_UNASSIGNED)} className={rowClass(currentTeam === team.id && currentOwner === OWNER_UNASSIGNED)}>
                        <span className="truncate">Unassigned</span>
                        <Count value={team.unassigned} />
                      </Link>
                    </li>
                    {team.members.map((member) => (
                      <li key={member.id}>
                        <Link href={opportunityFolderHref(team.id, member.id)} className={rowClass(currentTeam === team.id && currentOwner === member.id)}>
                          <span className="truncate" title={member.name}>
                            {member.name}
                          </span>
                          <Count value={member.count} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
