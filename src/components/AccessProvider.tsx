"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { checkAccess } from "@/lib/access-check"
import type { EffectiveAccess } from "@/lib/permissions"

const AccessContext = createContext<EffectiveAccess | null>(null)

// The signed in user's effective access, handed down by the dashboard
// layout from the same session the sidebar's page list comes from. For
// hiding or disabling UI only: every API route checks access itself.
export function AccessProvider({ access, children }: { access: EffectiveAccess | null; children: ReactNode }) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>
}

// can("quotes.edit") is true for Global Admin and for anyone holding it
export function useAccess() {
  const access = useContext(AccessContext)
  return useMemo(() => ({ access, can: (path: string) => checkAccess(access, path) }), [access])
}
