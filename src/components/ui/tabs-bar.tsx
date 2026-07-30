"use client"

import { useState, useRef, useLayoutEffect } from "react"

export interface TabItem<T extends string> {
  key: T
  label: string
}

interface TabsBarProps<T extends string> {
  tabs: TabItem<T>[]
  activeTab: T
  onChange: (key: T) => void
  ariaLabel: string
}

// Shared Tabs System component: sliding active indicator, full keyboard
// nav (arrows/Home/End), proper ARIA roles, and a horizontally scrollable
// strip (scrollbar hidden) for cases with more tabs than fit on screen.
export function TabsBar<T extends string>({ tabs, activeTab, onChange, ariaLabel }: TabsBarProps<T>) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const btn = tabRefs.current[activeTab]
    if (btn) setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [activeTab])

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    let nextIdx = idx
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === "Home") nextIdx = 0
    else if (e.key === "End") nextIdx = tabs.length - 1
    else return
    e.preventDefault()
    const nextKey = tabs[nextIdx].key
    onChange(nextKey)
    tabRefs.current[nextKey]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex gap-4 border-b border-border text-sm overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab, idx) => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[tab.key] = el
            }}
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`pb-2 whitespace-nowrap rounded-t-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              isActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        )
      })}
      <div
        className="absolute bottom-0 h-0.5 bg-primary transition-[left,width] duration-300"
        style={{ left: indicator.left, width: indicator.width, transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      />
    </div>
  )
}