"use client"

import { useCallback, useEffect, useState } from "react"
import { Bookmark, BookmarkPlus, MoreHorizontal } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import { cn } from "@/lib/utils"
import { SAVED_VIEW_NAME_MAX, SAVED_VIEWS_PER_PAGE_MAX, type SavedViewData, type SavedViewPage } from "@/lib/saved-views"

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null)
  if (!res) return { ok: false, data: { error: "Couldn't reach the server. Try again." } }
  return { ok: res.ok, data: await res.json().catch(() => ({})) }
}

const errorOf = (data: unknown, fallback: string) =>
  data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : fallback

// The signed in user's own views for a page (GET /api/saved-views)
export function useSavedViews(page: SavedViewPage) {
  const [views, setViews] = useState<SavedViewData[]>([])
  const load = useCallback(() => {
    fetch(`/api/saved-views?page=${page}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => Array.isArray(data) && setViews(data))
      .catch(() => undefined)
  }, [page])
  useEffect(() => {
    load()
  }, [load])
  return { views, setViews, reload: load }
}

// A list page's personal saved views, after its built in views (the same
// pressed button look as ViewTabs): one tab per view, the one matching the
// list's current filters shown as in use, each with a small menu (Rename,
// Update to the current filters, Move left, Move right, Delete), and a Save
// view button that names the current filters. params is what Save view
// saves, the page's query as its saved view reader expects it
// (src/lib/saved-views.ts); onApply opens a view. Only the user's own views
// are listed, and every change goes through the saved view routes.
export function SavedViewTabs({
  page,
  params,
  activeId,
  onApply,
  views,
  setViews,
  reload,
}: {
  page: SavedViewPage
  params: Record<string, unknown>
  // The view matching the list's current filters, or null
  activeId: string | null
  onApply: (view: SavedViewData) => void
} & ReturnType<typeof useSavedViews>) {
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<{ ok: boolean; data: unknown }>, failure: string, success?: string) {
    setBusy(true)
    const { ok, data } = await action()
    setBusy(false)
    if (!ok) {
      toast.error(failure, errorOf(data, "Try again."))
      reload()
      return null
    }
    if (success) toast.success(success)
    return data
  }

  async function saveNew() {
    const name = await promptDialog({ title: "Save view", description: "Name the current filters and sort. Only you see your views.", confirmLabel: "Save", placeholder: "For example: My urgent tickets" })
    if (name === null) return
    if (name.trim().length > SAVED_VIEW_NAME_MAX) {
      toast.error("Couldn't save the view", `A view name must be ${SAVED_VIEW_NAME_MAX} characters or fewer`)
      return
    }
    const created = await run(() => send("/api/saved-views", "POST", { page, name, params }), "Couldn't save the view", "View saved")
    if (created) setViews((prev) => [...prev, created as SavedViewData])
  }

  async function rename(view: SavedViewData) {
    const name = await promptDialog({ title: `Rename ${view.name}`, defaultValue: view.name, confirmLabel: "Save" })
    if (name === null || name.trim() === view.name) return
    const saved = await run(() => send(`/api/saved-views/${view.id}`, "PATCH", { name }), "Couldn't rename the view", "View renamed")
    if (saved) setViews((prev) => prev.map((v) => (v.id === view.id ? (saved as SavedViewData) : v)))
  }

  async function update(view: SavedViewData) {
    const saved = await run(() => send(`/api/saved-views/${view.id}`, "PATCH", { params }), "Couldn't update the view", `${view.name} now holds the current filters`)
    if (saved) setViews((prev) => prev.map((v) => (v.id === view.id ? (saved as SavedViewData) : v)))
  }

  async function remove(view: SavedViewData) {
    const ok = await confirmDialog({ title: `Delete the ${view.name} view?`, description: "Only the saved view is removed; no tickets change.", confirmLabel: "Delete", variant: "danger" })
    if (!ok) return
    const done = await run(() => send(`/api/saved-views/${view.id}`, "DELETE"), "Couldn't delete the view", "View deleted")
    if (done) setViews((prev) => prev.filter((v) => v.id !== view.id))
  }

  async function move(view: SavedViewData, by: -1 | 1) {
    const from = views.findIndex((v) => v.id === view.id)
    const to = from + by
    if (from < 0 || to < 0 || to >= views.length) return
    const next = [...views]
    next.splice(to, 0, next.splice(from, 1)[0])
    const previous = views
    setViews(next)
    const saved = await run(() => send("/api/saved-views/reorder", "POST", { page, viewIds: next.map((v) => v.id) }), "Couldn't move the view")
    if (saved && Array.isArray(saved)) setViews(saved as SavedViewData[])
    else setViews(previous)
  }

  return (
    <div role="group" aria-label="Your saved views" className="flex flex-wrap items-center gap-2">
      {views.map((view, i) => {
        const on = view.id === activeId
        return (
          <span key={view.id} className={cn("inline-flex min-h-[34px] items-center rounded-control transition-colors", on ? "bg-acc-tint text-acc-ink" : "text-muted-foreground hover:bg-surface-2")}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onApply(view)}
              disabled={busy}
              title={view.name}
              className={cn(
                "inline-flex max-w-[220px] items-center gap-1.5 rounded-control py-[7px] pl-3 pr-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "font-semibold" : "font-medium hover:text-foreground"
              )}
            >
              <Bookmark size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{view.name}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Options for the ${view.name} view`}
                  disabled={busy}
                  className="mr-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-acc-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => rename(view)}>Rename</DropdownMenuItem>
                <DropdownMenuItem onClick={() => update(view)} disabled={on}>
                  Update to the current filters
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => move(view, -1)} disabled={i === 0}>
                  Move left
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => move(view, 1)} disabled={i === views.length - 1}>
                  Move right
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => remove(view)} className="text-danger focus:text-danger">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )
      })}
      <button
        type="button"
        onClick={saveNew}
        disabled={busy || !!activeId || views.length >= SAVED_VIEWS_PER_PAGE_MAX}
        title={activeId ? "These filters are already saved" : views.length >= SAVED_VIEWS_PER_PAGE_MAX ? `You can save up to ${SAVED_VIEWS_PER_PAGE_MAX} views` : "Save the current filters and sort as a view"}
        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-control px-3 py-[7px] text-sm font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <BookmarkPlus size={15} aria-hidden="true" />
        Save view
      </button>
    </div>
  )
}
