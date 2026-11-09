"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

// Two places in the top bar a page fills from its own code: the breadcrumb
// and the page's primary action (New opportunity). The shared Breadcrumbs
// renders into the first by itself, so every page's trail shows in the top
// bar; a page puts its main button in the second with TopbarAction. Pages
// outside the dashboard (no top bar) render both in place instead.
type Slot = "crumbs" | "action"

interface Slots {
  targets: Record<Slot, HTMLElement | null>
  // State setters, so the ref callbacks keep one identity across renders
  setters: Record<Slot, (el: HTMLElement | null) => void>
}

const SlotsContext = createContext<Slots | null>(null)

export function TopbarSlotsProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<HTMLElement | null>(null)
  const [action, setAction] = useState<HTMLElement | null>(null)
  const value = useMemo<Slots>(() => ({ targets: { crumbs, action }, setters: { crumbs: setCrumbs, action: setAction } }), [crumbs, action])
  return <SlotsContext.Provider value={value}>{children}</SlotsContext.Provider>
}

// The element in the top bar a slot renders into
export function TopbarSlotTarget({ slot, className }: { slot: Slot; className?: string }) {
  const ctx = useContext(SlotsContext)
  return <div ref={ctx?.setters[slot]} className={className} />
}

// Renders its children in a top bar slot. Until the slot exists (the first
// render, and on the server) it renders nothing, so the page never jumps.
export function TopbarPortal({ slot, children }: { slot: Slot; children: ReactNode }) {
  const ctx = useContext(SlotsContext)
  if (!ctx) return <>{children}</>
  const target = ctx.targets[slot]
  return target ? createPortal(children, target) : null
}

// A page's primary action, shown in the top bar next to the notifications
export function TopbarAction({ children }: { children: ReactNode }) {
  return <TopbarPortal slot="action">{children}</TopbarPortal>
}
