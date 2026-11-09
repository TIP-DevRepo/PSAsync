"use client"

import { useEffect, useState } from "react"
import type { TeamSummary } from "@/lib/team-rules"
import type { TicketOption, TicketStatusOption } from "@/lib/ticket-view"

export interface TicketOptions {
  teams: TeamSummary[]
  users: { id: string; name: string; active: boolean }[]
  types: TicketOption[]
  priorities: TicketOption[]
  statuses: TicketStatusOption[]
  clients: { id: string; name: string }[]
  // Ticket Settings' default queue (GET /api/ticket-settings)
  defaultTeamId: string | null
  loaded: boolean
}

const EMPTY: TicketOptions = { teams: [], users: [], types: [], priorities: [], statuses: [], clients: [], defaultTeamId: null, loaded: false }

// The lists the ticket screens choose from, loaded once per page: the
// queues (GET /api/teams, with who may be assigned in each), every user's
// name, the company's types, priorities, and statuses in their order, the
// client list, and the default queue. Every route here is open to anyone
// who can open tickets.
export function useTicketOptions(): TicketOptions {
  const [options, setOptions] = useState<TicketOptions>(EMPTY)
  useEffect(() => {
    let cancelled = false
    const list = (url: string) =>
      fetch(url)
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => (Array.isArray(data) ? data : []))
        .catch(() => [])
    Promise.all([
      list("/api/teams"),
      list("/api/users"),
      list("/api/ticket-types"),
      list("/api/ticket-priorities"),
      list("/api/ticket-statuses"),
      list("/api/clients"),
      fetch("/api/ticket-settings")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([teams, users, types, priorities, statuses, clients, settings]) => {
      if (cancelled) return
      setOptions({
        teams,
        users,
        types,
        priorities,
        statuses,
        clients: clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })),
        defaultTeamId: settings && typeof settings.defaultTeamId === "string" ? settings.defaultTeamId : null,
        loaded: true,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])
  return options
}
