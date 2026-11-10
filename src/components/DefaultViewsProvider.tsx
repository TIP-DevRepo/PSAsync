"use client"

import { createContext, useContext, type ReactNode } from "react"
import { PSASYNC_DEFAULT_VIEWS, type SidebarDefaultViews } from "@/lib/sidebar-layout"

// The default views of the signed in user's sidebar layout (the user's,
// then the company's, then the PSAsync default; src/lib/sidebar-layout.ts),
// filled by the dashboard layout. A list page uses its default only when
// its URL doesn't already choose a view.
const DefaultViewsContext = createContext<SidebarDefaultViews>(PSASYNC_DEFAULT_VIEWS)

export function DefaultViewsProvider({ defaultViews, children }: { defaultViews: SidebarDefaultViews; children: ReactNode }) {
  return <DefaultViewsContext.Provider value={defaultViews}>{children}</DefaultViewsContext.Provider>
}

export function useDefaultViews(): SidebarDefaultViews {
  return useContext(DefaultViewsContext)
}
