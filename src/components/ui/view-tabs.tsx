"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// ─── ViewTabs ───────────────────────────────────────────────────────────────
// View switches (Board and List, My tickets and Unassigned):
// the chosen one tinted in the accent, each with an optional count. They
// change what the list below shows, so they are pressed buttons, not tabs.
// A client component (it handles clicks); the icon is a rendered element,
// for example icon: <Columns3 size={15} aria-hidden="true" />, so the list
// of views is plain data.
export interface ViewTabItem<K extends string> {
  key: K
  label: string
  count?: number
  icon?: ReactNode
}

export function ViewTabs<K extends string>({ views, active, onChange, ariaLabel }: { views: readonly ViewTabItem<K>[]; active: K; onChange: (key: K) => void; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {views.map(({ key, label, count, icon }) => {
        const on = key === active
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex min-h-[34px] items-center gap-1.5 rounded-control px-3 py-[7px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-acc-tint font-semibold text-acc-ink" : "font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            )}
          >
            {icon}
            {label}
            {count !== undefined && <span className="text-xs tabular-nums opacity-80">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
