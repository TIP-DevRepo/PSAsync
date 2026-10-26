"use client"

import { useEffect, useState } from "react"

export interface ContactOption {
  id: string
  firstName: string
  lastName: string
}

// The chosen client's contacts, read from the same open picker route the
// quote page's Contact select uses (GET /api/clients/[id])
export function useClientContacts(clientId: string) {
  const [state, setState] = useState<{ clientId: string; contacts: ContactOption[] }>({ clientId: "", contacts: [] })

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    fetch(`/api/clients/${clientId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setState({ clientId, contacts: Array.isArray(data?.contacts) ? data.contacts : [] })
      })
      .catch(() => {
        if (!cancelled) setState({ clientId, contacts: [] })
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  // Nothing from an earlier client while the new one loads
  const ready = !!clientId && state.clientId === clientId
  return { contacts: ready ? state.contacts : [], loading: !!clientId && !ready }
}
