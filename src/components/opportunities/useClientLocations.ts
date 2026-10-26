"use client"

import { useEffect, useState } from "react"
import { mainClientLocation } from "@/lib/client-main-location"
import type { ClientLocationSummary } from "@/lib/opportunity-view"

// A client's locations (sorted by name) and its main location's id, from the
// open picker route other forms read (GET /api/clients/[id]). Reloads when
// the client changes; nothing from an earlier client shows while it loads.
export function useClientLocations(clientId: string | null) {
  const [state, setState] = useState<{ clientId: string; locations: ClientLocationSummary[]; mainId: string | null }>({
    clientId: "",
    locations: [],
    mainId: null,
  })

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    fetch(`/api/clients/${clientId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const locations: ClientLocationSummary[] = Array.isArray(data?.locations)
          ? [...data.locations].sort((a: ClientLocationSummary, b: ClientLocationSummary) => a.name.localeCompare(b.name))
          : []
        const main = mainClientLocation({ locations, mainBillingLocation: data?.mainBillingLocation ?? null })
        setState({ clientId, locations, mainId: main?.id ?? null })
      })
      .catch(() => !cancelled && setState({ clientId, locations: [], mainId: null }))
    return () => {
      cancelled = true
    }
  }, [clientId])

  const ready = !!clientId && state.clientId === clientId
  return { locations: ready ? state.locations : [], mainId: ready ? state.mainId : null, loading: !!clientId && !ready }
}
