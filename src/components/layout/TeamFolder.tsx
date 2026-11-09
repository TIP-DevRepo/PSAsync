"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { NAV_ROW, NavIcon, navRowState, type NavIconName } from "./sidebar"
import { OPPORTUNITIES_CHANGED_EVENT, opportunityFolderHref, OWNER_UNASSIGNED } from "@/lib/opportunity-view"
import { ASSIGNEE_UNASSIGNED, ticketFolderHref } from "@/lib/ticket-list"
import { TICKETS_CHANGED_EVENT } from "@/lib/ticket-view"
import type { SidebarCounts } from "@/lib/team-rules"

// One record type's folder: where it lives, where its counts come from,
// the event that reloads them, and the URL parameter that holds the person
// (owner or assignee). Plain data, so both folders share every behavior.
export interface TeamFolderConfig {
  key: "opportunities" | "tickets"
  label: string
  icon: NavIconName
  listPath: string
  countsUrl: string
  changedEvent: string
  allLabel: string
  // The person parameter on the list's URL, and its "nobody" value
  personParam: "owner" | "assignee"
  unassignedValue: string
  // What the counts count, for screen readers ("3 open")
  countNoun: string
  // The chevron's label, "opportunity teams" or "ticket queues"
  groupNoun: string
  href: (team?: string, person?: string) => string
}

export const OPPORTUNITIES_FOLDER: TeamFolderConfig = {
  key: "opportunities",
  label: "Opportunities",
  icon: "opp",
  listPath: "/dashboard/opportunities",
  countsUrl: "/api/opportunities/sidebar-counts",
  changedEvent: OPPORTUNITIES_CHANGED_EVENT,
  allLabel: "All opportunities",
  personParam: "owner",
  unassignedValue: OWNER_UNASSIGNED,
  countNoun: "open",
  groupNoun: "opportunity teams",
  href: opportunityFolderHref,
}

// Tickets count OPEN and WAITING tickets (GET /api/tickets/sidebar-counts)
export const TICKETS_FOLDER: TeamFolderConfig = {
  key: "tickets",
  label: "Tickets",
  icon: "ticket",
  listPath: "/dashboard/tickets",
  countsUrl: "/api/tickets/sidebar-counts",
  changedEvent: TICKETS_CHANGED_EVENT,
  allLabel: "All tickets",
  personParam: "assignee",
  unassignedValue: ASSIGNEE_UNASSIGNED,
  countNoun: "open",
  groupNoun: "ticket queues",
  href: ticketFolderHref,
}

// Whether a folder is open, kept per browser. Storage can be missing or
// refuse access (a private window, blocked site data), so every read and
// write is wrapped and the folder simply starts closed. The opportunities
// key is the one it always used.
const openKey = (key: TeamFolderConfig["key"]) => `psasync.sidebar.${key}Open`
const OPEN_CHANGED = "psasync:sidebar-folder-open"

function readOpen(key: TeamFolderConfig["key"]): boolean {
  try {
    return window.localStorage.getItem(openKey(key)) === "1"
  } catch {
    return false
  }
}

function writeOpen(key: TeamFolderConfig["key"], open: boolean) {
  try {
    window.localStorage.setItem(openKey(key), open ? "1" : "0")
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

function Count({ value, noun }: { value: number | undefined; noun: string }) {
  if (value === undefined) return null
  return (
    <span className="ml-auto shrink-0 text-xs tabular-nums text-sb-muted" aria-label={`${value} ${noun}`}>
      {value}
    </span>
  )
}

// A sidebar entry as an expandable folder of teams (HaloPSA style), shared
// by Opportunities and Tickets (whose teams are its queues): the entry
// itself opens the list, and its chevron shows the "All" row, then each
// team in order, each expanding to Unassigned and its members, every row
// with its count of open records the user can see (one request for the
// whole folder). A team opens the list filtered to it, a member to that
// team and person, Unassigned to that team's unassigned ones. Counts reload
// when the folder opens, when the window regains focus, and when a page
// reports a change (the config's changed event). The entry's badge is the
// total from the same request, so the counts also load (once) while the
// folder is closed. The mobile menu shows the same folder; the sidebar has
// no collapsed mode.
export function TeamFolder({ config, isActive }: { config: TeamFolderConfig; isActive: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const open = useSyncExternalStore(
    subscribeOpen,
    () => readOpen(config.key),
    () => false
  )
  const [counts, setCounts] = useState<SidebarCounts | null>(null)
  // Teams opened or closed in this page view; the team the list is
  // filtered to starts open
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map())

  const onList = pathname === config.listPath
  const currentTeam = onList ? (searchParams.get("team") ?? "") : ""
  const currentPerson = onList ? (searchParams.get(config.personParam) ?? "") : ""

  const { countsUrl, changedEvent } = config
  const load = useCallback(() => {
    fetch(countsUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SidebarCounts | null) => {
        if (data && Array.isArray(data.teams)) setCounts(data)
      })
      .catch(() => {
        // Keep the last counts; the next focus or change tries again
      })
  }, [countsUrl])

  // Once for the badge, again whenever the folder opens; while open, also on
  // focus. A reported change always reloads, since the badge shows it.
  useEffect(() => {
    load()
    window.addEventListener(changedEvent, load)
    return () => window.removeEventListener(changedEvent, load)
  }, [load, changedEvent])
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
  const folderId = `sidebar-${config.key}-folder`

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link href={config.listPath} aria-current={isActive ? "page" : undefined} className={cn(NAV_ROW, "flex-1", navRowState(isActive))}>
          <NavIcon name={config.icon} />
          <span className="min-w-0 flex-1 truncate">{config.label}</span>
          {counts && (
            <span
              aria-label={`${counts.total} ${config.countNoun}`}
              className="min-w-5 rounded-full bg-sb-badge px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-sb-badge-text"
            >
              {counts.total}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => writeOpen(config.key, !open)}
          aria-expanded={open}
          aria-controls={folderId}
          aria-label={open ? `Hide ${config.groupNoun}` : `Show ${config.groupNoun}`}
          className={CHEVRON_BUTTON}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform duration-200 ease-out", open && "rotate-90")} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <ul id={folderId} className="mb-1.5 ml-5 mt-0.5 space-y-0.5 border-l border-sb-border pl-2.5">
          <li>
            <Link href={config.href()} className={rowClass(onList && !currentTeam && !currentPerson)}>
              <span className="truncate">{config.allLabel}</span>
              <Count value={counts?.total} noun={config.countNoun} />
            </Link>
          </li>
          {counts === null && <li className="px-2.5 py-1.5 text-xs text-sb-muted">Loading...</li>}
          {counts?.teams.map((team) => {
            const teamOpen = isExpanded(team.id)
            const groupId = `sidebar-${config.key}-team-${team.id}`
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
                  <Link href={config.href(team.id)} className={rowClass(currentTeam === team.id && !currentPerson)}>
                    <span className="truncate" title={team.name}>
                      {team.name}
                    </span>
                    <Count value={team.count} noun={config.countNoun} />
                  </Link>
                </div>
                {teamOpen && (
                  <ul id={groupId} className="ml-7 space-y-0.5">
                    <li>
                      <Link href={config.href(team.id, config.unassignedValue)} className={rowClass(currentTeam === team.id && currentPerson === config.unassignedValue)}>
                        <span className="truncate">Unassigned</span>
                        <Count value={team.unassigned} noun={config.countNoun} />
                      </Link>
                    </li>
                    {team.members.map((member) => (
                      <li key={member.id}>
                        <Link href={config.href(team.id, member.id)} className={rowClass(currentTeam === team.id && currentPerson === member.id)}>
                          <span className="truncate" title={member.name}>
                            {member.name}
                          </span>
                          <Count value={member.count} noun={config.countNoun} />
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
