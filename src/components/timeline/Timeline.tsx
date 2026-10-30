"use client"

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { Activity, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { toast } from "@/lib/toast"
import { confirmDialog } from "@/lib/confirm-dialog"
import { describeTimelineAction, emailOutDetails, entryActionButton, isBlankHtml, noteStageChange } from "@/lib/timeline-actions"
import { presetStageId, type ActionButtonDefinition } from "@/lib/timeline-buttons"
import { CATEGORY_LABELS } from "@/lib/opportunity-rules"
import type { StageCategory } from "@/lib/opportunity-view"
import { StagePill } from "@/components/opportunities/StagePill"
import { ActionButtonBar } from "./ActionButtonBar"
import { EmailAttachmentPicker, EmailFields, type EmailDraft, type EmailOptions } from "./EmailComposer"
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

// A stage a note can move its record to, in the company's order
// What a page that shows the action bar itself can do with the timeline
export interface TimelineHandle {
  openComposer: (button: ActionButtonDefinition) => void
}

export interface TimelineStageOption {
  id: string
  name: string
  category: StageCategory
}

const STAGE_GROUPS: StageCategory[] = ["OPEN", "WON", "LOST"]

// What the Email action needs from the page: where to send, the record's
// attachments, the From choices and contacts (null while loading), and the
// defaults a new email starts with
export interface TimelineEmailContext {
  sendUrl: string
  attachmentsUrl: string
  options: EmailOptions | null
  defaultSubject: string
  defaultTo: string[]
}

// The timeline of one record (an opportunity now, a ticket later): a row of
// action buttons that open the note composer, then every entry newest
// first, with older pages on request. timelineUrl is the record's timeline
// route; an entry's own route is timelineUrl/entryId. refreshKey reloads
// the first page, for a page that just made a change the server recorded
// as an action. With stages, the composer can also move the record to a
// stage (sent as stageId with the note) as the button's stage mode allows:
// not at all, a stage the user picks, or the button's fixed stage, shown
// read only. A button whose note is required keeps Post disabled until
// there is text. The note is sent with the button's id, so the server
// applies the same rules. onPosted runs after a note is saved so the page
// can reload what the note changed.
export function Timeline({
  timelineUrl,
  canAddNotes,
  myUserId,
  refreshKey = 0,
  buttons,
  unavailableReason,
  stages,
  email,
  onPosted,
  showButtons = true,
  onComposerChange,
  ref,
}: {
  timelineUrl: string
  // opportunities.edit (or the subject's own edit permission); also needed
  // to use the buttons and to edit or delete one's own notes
  canAddNotes: boolean
  myUserId: string | null
  refreshKey?: number
  // The action bar's buttons (src/lib/timeline-buttons.ts), shown to
  // everyone who can view the record
  buttons: readonly ActionButtonDefinition[]
  // Why a button can't be used (no edit access), or null
  unavailableReason?: (button: ActionButtonDefinition) => string | null
  stages?: readonly TimelineStageOption[]
  // Needed for EMAIL buttons
  email?: TimelineEmailContext
  onPosted?: (entry: TimelineEntryData) => void
  // False when the page shows the bar elsewhere (the opportunity header) and
  // opens the composer through ref.openComposer
  showButtons?: boolean
  // The button whose composer is open, or null, for a bar shown elsewhere
  onComposerChange?: (buttonId: string | null) => void
  ref?: Ref<TimelineHandle>
}) {
  const [entries, setEntries] = useState<TimelineEntryData[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  // The url and refresh the entries on screen came from; loading until they match
  const pageKey = `${timelineUrl}#${refreshKey}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // The open composer: the button that opened it, the note, and the stage
  // it moves the record to ("" for no change). Null while closed.
  const [composer, setComposer] = useState<{ button: ActionButtonDefinition; html: string; stageId: string } | null>(null)
  // The email being written, kept while switching buttons. Null until an
  // EMAIL button opens the composer.
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null)
  const [attachmentBytes, setAttachmentBytes] = useState(0)
  const updateEmail = useCallback((patch: Partial<EmailDraft>) => setEmailDraft((prev) => (prev ? { ...prev, ...patch, dirty: true } : prev)), [])
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

  // A button opens the composer with its presets. Switching buttons while it
  // is open keeps the text and only changes the preset stage.
  useImperativeHandle(ref, () => ({ openComposer }))

  const composerRef = useRef<HTMLDivElement>(null)
  const openButtonId = composer?.button.id ?? null
  // A bar outside the timeline (the header) shows which button is open, and
  // the composer is brought into view, which matters when the timeline sits
  // below the details panel at phone width
  useEffect(() => {
    onComposerChange?.(openButtonId)
    if (openButtonId) composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [openButtonId, onComposerChange])

  function openComposer(button: ActionButtonDefinition) {
    if (!canAddNotes || unavailableReason?.(button)) return
    if (button.opens.kind === "email" && !email) return
    const stageId = presetStageId(button, stages ?? [])
    setComposer((prev) => ({ button, html: prev?.html ?? "", stageId }))
    if (button.opens.kind === "email") {
      setEmailDraft(
        (prev) =>
          prev ?? {
            fromId: email?.options?.defaultConnectionId ?? null,
            to: email?.defaultTo ?? [],
            cc: [],
            bcc: [],
            showCopies: false,
            subject: email?.defaultSubject ?? "",
            attachmentIds: [],
            dirty: false,
          }
      )
    }
  }

  // The From default may arrive after the composer opened, so a draft
  // without a pick of its own follows it
  const draft = emailDraft ? { ...emailDraft, fromId: emailDraft.fromId ?? email?.options?.defaultConnectionId ?? null } : null

  const isEmail = composer?.button.opens.kind === "email"
  const hasText = !!composer && !isBlankHtml(composer.html)
  // Post needs text when the button requires it, and an empty optional
  // note must at least move the stage. An email also needs a recipient, a
  // subject, and attachments within the limit.
  const canPost =
    !!composer &&
    (isEmail
      ? !!draft &&
        draft.to.length > 0 &&
        !!draft.subject.trim() &&
        attachmentBytes <= (email?.options?.maxAttachmentBytes ?? Infinity) &&
        (hasText || !composer.button.opens.noteRequired)
      : hasText || (!composer.button.opens.noteRequired && !!composer.stageId))

  function resetComposer() {
    setComposer(null)
    setEmailDraft(null)
    setAttachmentBytes(0)
  }

  async function closeComposer() {
    if (composer && (hasText || (isEmail && draft?.dirty))) {
      const discard = await confirmDialog({
        title: isEmail ? "Discard this email?" : "Discard this note?",
        description: "What you typed will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep writing",
        variant: "danger",
      })
      if (!discard) return
    }
    resetComposer()
  }

  async function sendEmail() {
    if (!composer || !draft || !email || !canPost) return
    setPosting(true)
    const res = await fetch(email.sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: composer.html,
        attachmentIds: draft.attachmentIds,
        actionButtonId: composer.button.id,
        ...(composer.stageId ? { stageId: composer.stageId } : {}),
        // Only someone allowed to choose sends a pick; anyone else always
        // sends from their default
        ...(email.options?.canChooseSender && draft.fromId ? { sendAsConnectionId: draft.fromId } : {}),
      }),
    })
    setPosting(false)
    if (!res.ok) {
      toast.error("Couldn't send the email", await errorMessage(res, "Try again."))
      return
    }
    const entry: TimelineEntryData = await res.json()
    setEntries((prev) => [entry, ...prev])
    resetComposer()
    toast.success("Email sent")
    onPosted?.(entry)
  }

  async function addNote() {
    if (!composer || !canPost) return
    setPosting(true)
    const res = await fetch(timelineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: composer.html,
        actionButtonId: composer.button.id,
        ...(composer.stageId ? { stageId: composer.stageId } : {}),
      }),
    })
    setPosting(false)
    if (!res.ok) {
      toast.error("Couldn't add the note", await errorMessage(res, "Try again."))
      return
    }
    const entry: TimelineEntryData = await res.json()
    setEntries((prev) => [entry, ...prev])
    resetComposer()
    onPosted?.(entry)
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

      {showButtons && (
        <ActionButtonBar buttons={buttons} onSelect={openComposer} activeId={openButtonId} unavailableReason={unavailableReason} label="Timeline actions" />
      )}

      {canAddNotes && composer && (
        <div ref={composerRef} className="scroll-mt-4 space-y-3 rounded-lg border border-border bg-card p-3 shadow-card">
          <p className="text-sm font-medium text-foreground">
            {composer.button.label}
            {!composer.button.opens.noteRequired && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{isEmail ? "Message optional" : "Note optional"}</span>
            )}
          </p>
          {isEmail && draft && email && <EmailFields draft={draft} options={email.options} onChange={updateEmail} disabled={posting} />}
          <RichTextEditor
            value={composer.html}
            onChange={(html) => setComposer((prev) => (prev ? { ...prev, html } : prev))}
            ariaLabel={isEmail ? "Email message" : "New note"}
          />
          {isEmail && draft && email && (
            <>
              {email.options?.signature && (
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium">Added under your message</p>
                  <p className="whitespace-pre-line">{email.options.signature}</p>
                </div>
              )}
              <EmailAttachmentPicker
                attachmentsUrl={email.attachmentsUrl}
                selected={draft.attachmentIds}
                maxBytes={email.options?.maxAttachmentBytes ?? Infinity}
                onChange={(attachmentIds) => updateEmail({ attachmentIds })}
                onTotalChange={setAttachmentBytes}
                disabled={posting}
              />
            </>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            {composer.button.opens.stageMode === "FIXED" ? (
              <FixedStage stage={stages?.find((st) => st.id === composer.stageId) ?? null} />
            ) : composer.button.opens.stageMode === "CHOOSE" && stages && stages.length > 0 ? (
              <div className="w-full sm:w-64">
                <label htmlFor="timeline-composer-stage" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Change stage to
                </label>
                <select
                  id="timeline-composer-stage"
                  value={composer.stageId}
                  onChange={(e) => setComposer((prev) => (prev ? { ...prev, stageId: e.target.value } : prev))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">No change</option>
                  {STAGE_GROUPS.map((category) => {
                    const inGroup = stages.filter((st) => st.category === category)
                    return inGroup.length === 0 ? null : (
                      <optgroup key={category} label={CATEGORY_LABELS[category]}>
                        {inGroup.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeComposer} disabled={posting}>
                Cancel
              </Button>
              {isEmail ? (
                <Button onClick={sendEmail} disabled={posting || !canPost}>
                  {posting ? "Sending..." : "Send"}
                </Button>
              ) : (
                <Button onClick={addNote} disabled={posting || !canPost}>
                  {posting ? "Posting..." : "Post"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {failed && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the timeline. Refresh to try again.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.{canAddNotes ? " Use Note above to add the first one." : ""}</p>
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
                    <EntryButtonLabel data={entry.data} />
                    <NoteStagePill data={entry.data} />
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
                ) : entry.kind === "EMAIL_OUT" ? (
                  <EmailBody entry={entry} />
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

// An "Email sent" card's details: from, to, CC, subject, attachments, and
// the body (sanitized by the API) collapsed to a few lines with Show more
function EmailBody({ entry }: { entry: TimelineEntryData }) {
  const [expanded, setExpanded] = useState(false)
  const details = emailOutDetails(entry.data)
  // Roughly more than the few lines shown collapsed
  const html = entry.body ?? ""
  const long = html.replace(/<[^>]*>/g, "").length > 280 || (html.match(/<(p|br|li)\b/g)?.length ?? 0) > 4
  const row = (label: string, value: string) => (
    <div className="flex min-w-0 gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  )
  return (
    <div className="space-y-2">
      {details && (
        <dl className="space-y-0.5 text-xs">
          {row("From", details.from)}
          {row("To", details.to.join(", "))}
          {details.cc.length > 0 && row("CC", details.cc.join(", "))}
          {details.bcc.length > 0 && row("BCC", details.bcc.join(", "))}
          {row("Subject", details.subject)}
          {details.attachments.length > 0 && row("Files", details.attachments.join(", "))}
        </dl>
      )}
      <div className={cn(NOTE_HTML, long && !expanded && "max-h-24 overflow-hidden")} dangerouslySetInnerHTML={{ __html: html }} />
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="text-xs font-medium text-primary hover:underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

// The stage a fixed stage button moves to, read only
function FixedStage({ stage }: { stage: TimelineStageOption | null }) {
  return (
    <div className="w-full sm:w-64">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Moves stage to</p>
      {stage ? <StagePill name={stage.name} category={stage.category} /> : <p className="text-sm text-muted-foreground">Loading...</p>}
    </div>
  )
}

// The action button an entry was made with, as it was named then
function EntryButtonLabel({ data }: { data: unknown }) {
  const button = entryActionButton(data)
  if (!button) return null
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{button.name}</span>
}

// A note posted with a stage change shows the move, for example "New to
// Qualified", tinted by the stage it moved to
function NoteStagePill({ data }: { data: unknown }) {
  const change = noteStageChange(data)
  if (!change) return null
  const label = `${change.from.name} to ${change.to.name}`
  const category = change.to.category
  return category === "OPEN" || category === "WON" || category === "LOST" ? (
    <StagePill name={label} category={category} />
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{label}</span>
  )
}
