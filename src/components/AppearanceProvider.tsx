"use client"

import { createContext, useContext, type ReactNode } from "react"
import { DEFAULT_DENSITY, type RowDensityChoice } from "@/lib/theme"

// The signed in user's own display preferences that pages read, handed
// down by the dashboard layout. Row density (My settings > Appearance) sets
// how tall list rows are on every list page; the colors need no context,
// since they are CSS variables on the page.
const AppearanceContext = createContext<{ rowDensity: RowDensityChoice }>({ rowDensity: DEFAULT_DENSITY })

export function AppearanceProvider({ rowDensity, children }: { rowDensity: RowDensityChoice; children: ReactNode }) {
  return <AppearanceContext.Provider value={{ rowDensity }}>{children}</AppearanceContext.Provider>
}

// The list pages' row density, lower case as their padding tables use it
export function useRowDensity(): "compact" | "default" | "comfortable" {
  const { rowDensity } = useContext(AppearanceContext)
  return rowDensity === "COMPACT" ? "compact" : rowDensity === "COMFORTABLE" ? "comfortable" : "default"
}
