"use client"

import { useEffect, useId, useState } from "react"
import { X } from "lucide-react"
import { isEmailAddress } from "@/lib/email-address"
import { RECORD_EMAIL_SUBJECT_MAX } from "@/lib/record-email"
import { formatMegabytes } from "@/lib/upload-rules"
import { cn } from "@/lib/utils"

// The email parts of the timeline composer (the Email action): From, To,
// CC and BCC, Subject, and the record's attachments to send with it. The
// body editor, stage, and Send live in the composer itself (Timeline).

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const LABEL = "mb-1 block text-xs font-medium text-muted-foreground"

export interface SenderOption {
  connectionId: string
  email: string
  ownerName: string | null
  isShared: boolean
}

// GET /api/opportunities/[id]/email-options
export interface EmailOptions {
  defaultConnectionId: string | null
  defaultError: string | null
  canChooseSender: boolean
  options: SenderOption[]
  signature: string | null
  maxAttachmentBytes: number
  contacts: { id: string; name: string; email: string }[]
}

// Why the Email action can't be used: no mailbox to send from
export function emailUnavailableReason(options: EmailOptions | null): string | null {
  if (!options) return null
  if (options.defaultConnectionId || options.options.length > 0) return null
  return options.defaultError ?? "Connect your mailbox in Settings > Microsoft Integration to send email."
}

export interface EmailDraft {
  fromId: string | null
  to: string[]
  cc: string[]
  bcc: string[]
  showCopies: boolean
  subject: string
  attachmentIds: string[]
  // Anything changed since it opened, for the discard warning
  dirty: boolean
}

export interface EmailAttachmentOption {
  id: string
  fileName: string
  fileSize: number | null
}

function senderLabel(o: SenderOption) {
  const who = o.ownerName ? `${o.ownerName}, ${o.email}` : o.email
  return o.isShared ? `${who} (shared)` : who
}

export function EmailFields({
  draft,
  options,
  onChange,
  disabled,
}: {
  draft: EmailDraft
  options: EmailOptions | null
  onChange: (patch: Partial<EmailDraft>) => void
  disabled: boolean
}) {
  const contacts = options?.contacts ?? []
  const defaultSender = options?.options.find((o) => o.connectionId === options.defaultConnectionId)
  return (
    <div className="space-y-3">
      <div>
        {options?.canChooseSender ? (
          <>
            <label htmlFor="email-from" className={LABEL}>
              From
            </label>
            <select
              id="email-from"
              value={draft.fromId ?? ""}
              onChange={(e) => onChange({ fromId: e.target.value || null })}
              disabled={disabled}
              className={FIELD}
            >
              <option value="">Choose a mailbox</option>
              {options.options.map((o) => (
                <option key={o.connectionId} value={o.connectionId}>
                  {senderLabel(o)}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <p className={LABEL}>From</p>
            <p className="text-sm text-foreground">{options === null ? "Loading..." : defaultSender ? senderLabel(defaultSender) : "No mailbox available"}</p>
          </>
        )}
        {options?.defaultError && !draft.fromId && <p className="mt-1 text-xs text-danger">{options.defaultError}</p>}
      </div>

      <RecipientField id="email-to" label="To" value={draft.to} contacts={contacts} disabled={disabled} onChange={(to) => onChange({ to })} />
      {draft.showCopies ? (
        <>
          <RecipientField id="email-cc" label="CC" value={draft.cc} contacts={contacts} disabled={disabled} onChange={(cc) => onChange({ cc })} />
          <RecipientField id="email-bcc" label="BCC" value={draft.bcc} contacts={contacts} disabled={disabled} onChange={(bcc) => onChange({ bcc })} />
        </>
      ) : (
        <button type="button" onClick={() => onChange({ showCopies: true })} className="text-xs font-medium text-primary hover:underline">
          Add CC or BCC
        </button>
      )}

      <div>
        <label htmlFor="email-subject" className={LABEL}>
          Subject
        </label>
        <input
          id="email-subject"
          value={draft.subject}
          maxLength={RECORD_EMAIL_SUBJECT_MAX}
          onChange={(e) => onChange({ subject: e.target.value })}
          disabled={disabled}
          className={FIELD}
        />
      </div>
    </div>
  )
}

// Addresses as removable chips, plus a box that searches the client's
// contacts by name or email and also takes a typed address (Enter, comma,
// or leaving the box adds it). Backspace in an empty box removes the last.
function RecipientField({
  id,
  label,
  value,
  contacts,
  onChange,
  disabled,
}: {
  id: string
  label: string
  value: string[]
  contacts: EmailOptions["contacts"]
  onChange: (next: string[]) => void
  disabled: boolean
}) {
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listId = useId()

  const query = text.trim().toLowerCase()
  const suggestions = contacts
    .filter((c) => !value.some((v) => v.toLowerCase() === c.email.toLowerCase()))
    .filter((c) => !query || c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query))
    .slice(0, 8)

  function add(address: string) {
    const clean = address.trim().replace(/[,;]+$/, "")
    if (!clean) return
    if (!isEmailAddress(clean)) {
      setError(`"${clean}" is not a valid email address`)
      return
    }
    if (!value.some((v) => v.toLowerCase() === clean.toLowerCase())) onChange([...value, clean])
    setText("")
    setError(null)
    setHighlight(0)
  }

  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className={cn("flex flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring", disabled && "opacity-60")}>
        {value.map((address) => (
          <span key={address} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
            <span className="truncate" title={address}>
              {contacts.find((c) => c.email.toLowerCase() === address.toLowerCase())?.name ?? address}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== address))}
              disabled={disabled}
              aria-label={`Remove ${address}`}
              className="rounded-full text-muted-foreground hover:text-foreground"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <div className="relative min-w-[10rem] flex-1">
          <input
            id={id}
            value={text}
            disabled={disabled}
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={value.length === 0 ? "Search contacts or type an address" : ""}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              const next = e.target.value
              if (/[,;]$/.test(next)) {
                add(next)
                return
              }
              setText(next)
              setOpen(true)
              setHighlight(0)
              setError(null)
            }}
            onBlur={() => {
              setOpen(false)
              if (text.trim()) add(text)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setHighlight((h) => Math.min(h + 1, Math.max(suggestions.length - 1, 0)))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setHighlight((h) => Math.max(h - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                const pick = open ? suggestions[highlight] : undefined
                if (pick && (!query || !isEmailAddress(text.trim()))) add(pick.email)
                else add(text)
              } else if (e.key === "Escape") {
                setOpen(false)
              } else if (e.key === "Backspace" && !text && value.length > 0) {
                onChange(value.slice(0, -1))
              }
            }}
            className="w-full bg-transparent px-1 py-0.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {open && suggestions.length > 0 && (
            <ul id={listId} role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-60 w-full min-w-[16rem] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-popover">
              {suggestions.map((c, i) => (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={i === highlight}
                  // Keeps focus in the box, so blur doesn't add the half typed text first
                  onMouseDown={(e) => {
                    e.preventDefault()
                    add(c.email)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn("cursor-pointer px-3 py-1.5 text-sm", i === highlight ? "bg-surface-hover" : "")}
                >
                  <span className="text-foreground">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

// The record's attachments as tick boxes, with the total of the ticked
// ones against the limit Graph allows on one email
export function EmailAttachmentPicker({
  attachmentsUrl,
  selected,
  maxBytes,
  onChange,
  onTotalChange,
  disabled,
}: {
  attachmentsUrl: string
  selected: string[]
  maxBytes: number
  onChange: (ids: string[]) => void
  // The ticked files' total size, so the composer can hold Send while it
  // is over the limit
  onTotalChange: (bytes: number) => void
  disabled: boolean
}) {
  const [attachments, setAttachments] = useState<EmailAttachmentOption[] | null>(null)
  const [failed, setFailed] = useState(false)
  const total = emailAttachmentTotal(attachments ?? [], selected)

  useEffect(() => {
    onTotalChange(total)
  }, [total, onTotalChange])

  useEffect(() => {
    let cancelled = false
    fetch(attachmentsUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("refused"))))
      .then((data: EmailAttachmentOption[]) => {
        if (!cancelled) setAttachments(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [attachmentsUrl])

  if (failed) return <p className="text-xs text-danger">Couldn&apos;t load the attachments.</p>
  if (!attachments) return <p className="text-xs text-muted-foreground">Loading attachments...</p>
  if (attachments.length === 0) return <p className="text-xs text-muted-foreground">No attachments on this record.</p>

  const over = total > maxBytes
  return (
    <fieldset className="space-y-1">
      <legend className={LABEL}>Attachments</legend>
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li key={a.id}>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))}
                className="accent-primary"
              />
              <span className="min-w-0 truncate" title={a.fileName}>
                {a.fileName}
              </span>
              {a.fileSize !== null && <span className="shrink-0 text-xs text-muted-foreground">{formatMegabytes(a.fileSize)}</span>}
            </label>
          </li>
        ))}
      </ul>
      <p className={cn("text-xs", over ? "text-danger" : "text-muted-foreground")}>
        {formatMegabytes(total)} of {formatMegabytes(maxBytes)}
        {over ? ". Untick some files to send." : ""}
      </p>
    </fieldset>
  )
}

export function emailAttachmentTotal(attachments: readonly EmailAttachmentOption[], selected: readonly string[]): number {
  return attachments.filter((a) => selected.includes(a.id)).reduce((sum, a) => sum + (a.fileSize ?? 0), 0)
}
