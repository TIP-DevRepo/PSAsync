"use client"

import { useEffect, useState } from "react"
import { Activity, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { describeTimelineAction, isBlankHtml } from "@/lib/timeline-actions"
import { cn } from "@/lib/utils"

// One entry as every timeline route returns it (timelineEntrySelect). A
// note's body is HTML the API already sanitized.
export interface TimelineEntryData {
  id: string
  kind: "NOTE" | "ACTION" | "EMAIL_OUT" | "EMAIL_IN"
  action: string | null
  data: unknown
  body: string | null
  editedAt: string | null
  createdAt: string
  author: { id: string; name: string } | null
}

interface TimelinePage {
  entries: TimelineEntryData[]
  nextCursor: string | null
}

const NOTE_HTML =
  "text-sm text-foreground break-words [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 last:[&_p]:mb-0 [&_a]:text-primary [&_a]:underline"

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

async function errorMessage(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}))
  return typeof data.error === "string" ? data.error : fallback
}

// The timeline of one record (an opportunity now, a ticket later): a note
// composer, then every entry newest first, with older pages on request.
// timelineUrl is the record's timeline route; an entry's own route is
// timelineUrl/entryId. refreshKey reloads the first page, for a page that
// just made a change the server recorded as an action.
export function Timeline({
  timelineUrl,
  canAddNotes,
  myUserId,
  refreshKey = 0,
}: {
  timelineUrl: string
  // opportunities.edit (or the subject's own edit permission); also needed
  // to edit or delete one's own notes
  canAddNotes: boolean
  myUserId: string | null
  refreshKey?: number
}) {
  const [entries, setEntries] = useState<TimelineEntryData[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  // The url and refresh the entries on screen came from; loading until they match
  const pageKey = `${timelineUrl}#${refreshKey}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [editing, setEditing] = useState<{ id: string; html: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(timelineUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("refused"))))
      .then((page: TimelinePage) => {
        if (cancelled) return
        setEntries(page.entries)
        setNextCursor(page.nextCursor)
        setFailed(false)
        setLoadedKey(pageKey)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        setLoadedKey(pageKey)
      })
    return () => {
      cancelled = true
    }
  }, [timelineUrl, pageKey])

  async function loadOlder() {
    if (!nextCursor) return
    setLoadingMore(true)
    const res = await fetch(`${timelineUrl}?cursor=${encodeURIComponent(nextCursor)}`).catch(() => null)
    setLoadingMore(false)
    if (!res?.ok) {
      toast.error("Couldn't load older entries")
      return
    }
    const page: TimelinePage = await res.json()
    // An entry already shown (added while paging) is never listed twice
    setEntries((prev) => [...prev, ...page.entries.filter((e) => !prev.some((p) => p.id === e.id))])
    setNextCursor(page.nextCursor)
  }

  async function addNote() {
    if (isBlankHtml(draft)) return
    setPosting(true)
    const res = await fetch(timelineUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft }) })
    setPosting(false)
    if (!res.ok) {
      toast.error("Couldn't add the note", await errorMessage(res, "Try again."))
      return
    }
    const entry: TimelineEntryData = await res.json()
    setEntries((prev) => [entry, ...prev])
    setDraft("")
  }

  async function saveEdit() {
    if (!editing || isBlankHtml(editing.html)) return
    setBusyId(editing.id)
    const res = await fetch(`${timelineUrl}/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editing.html }),
    })
    setBusyId(null)
    if (!res.ok) {
      toast.error("Couldn't save the note", await errorMessage(res, "Try again."))
      return
    }
    const saved: TimelineEntryData = await res.json()
    setEntries((prev) => prev.map((e) => (e.id === saved.id ? saved : e)))
    setEditing(null)
  }

  async function deleteNote(entry: TimelineEntryData) {
    const confirmed = await confirmDialog({
      title: "Delete this note?",
      description: "The note is removed from the timeline. This can't be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    })
    if (!confirmed) return
    setBusyId(entry.id)
    const res = await fetch(`${timelineUrl}/${entry.id}`, { method: "DELETE" })
    setBusyId(null)
    if (!res.ok) {
      toast.error("Couldn't delete the note", await errorMessage(res, "Try again."))
      return
    }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    toast.success("Note deleted")
  }

  const loading = loadedKey !== pageKey && entries.length === 0

  return (
    <section aria-labelledby="timeline-heading" className="space-y-4">
      <h2 id="timeline-heading" className="text-heading font-semibold text-foreground">
        Timeline
      </h2>

      {canAddNotes && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-card">
          <RichTextEditor value={draft} onChange={setDraft} ariaLabel="New note" />
          <div className="flex justify-end">
            <Button onClick={addNote} disabled={posting || isBlankHtml(draft)}>
              {posting ? "Adding..." : "Add note"}
            </Button>
          </div>
        </div>
      )}

      {failed && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the timeline. Refresh to try again.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.{canAddNotes ? " Add the first note above." : ""}</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) =>
            entry.kind === "ACTION" ? (
              <li key={entry.id} className="flex items-start gap-2 px-1 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Activity size={12} aria-hidden="true" />
                </span>
                <p className="min-w-0 text-muted-foreground">
                  <span className="text-foreground">{describeTimelineAction(entry.action, entry.data)}</span>
                  <span className="whitespace-nowrap">
                    {" "}
                    · {entry.author?.name ?? "System"} · <time dateTime={entry.createdAt}>{when(entry.createdAt)}</time>
                  </span>
                </p>
              </li>
            ) : (
              <li key={entry.id} className="rounded-lg border border-border bg-card p-4 shadow-card">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {entry.kind !== "NOTE" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        <Mail size={12} aria-hidden="true" />
                        {entry.kind === "EMAIL_IN" ? "Email received" : "Email sent"}
                      </span>
                    )}
                    <span className="font-semibold text-foreground">{entry.author?.name ?? (entry.kind === "NOTE" ? "Former user" : "System")}</span>
                    <time dateTime={entry.createdAt}>{when(entry.createdAt)}</time>
                    {entry.editedAt && (
                      <span title={`Edited ${when(entry.editedAt)}`} className="italic">
                        edited
                      </span>
                    )}
                  </p>
                  {entry.kind === "NOTE" && canAddNotes && !!myUserId && entry.author?.id === myUserId && editing?.id !== entry.id && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: entry.id, html: entry.body ?? "" })}
                        disabled={busyId === entry.id}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteNote(entry)}
                        disabled={busyId === entry.id}
                        className="text-xs font-medium text-muted-foreground hover:text-danger disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {editing?.id === entry.id ? (
                  <div className="space-y-2">
                    <RichTextEditor value={editing.html} onChange={(html) => setEditing({ id: entry.id, html })} ariaLabel="Edit note" />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditing(null)} disabled={busyId === entry.id}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveEdit} disabled={busyId === entry.id || isBlankHtml(editing.html)}>
                        {busyId === entry.id ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  // Sanitized by the API on the way out (toTimelineEntryResponse)
                  <div className={cn(NOTE_HTML)} dangerouslySetInnerHTML={{ __html: entry.body ?? "" }} />
                )}
              </li>
            )
          )}
        </ol>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadOlder} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load older"}
          </Button>
        </div>
      )}
    </section>
  )
}
