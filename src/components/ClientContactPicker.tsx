"use client"

import { useEffect, useId, useRef, useState } from "react"
import type { ContactSearchResult } from "@/components/ContactSearchInput"
import {
  chooseClient,
  chooseContact,
  contactFullName,
  matchClients,
  matchesContactQuery,
  PICKER_SEARCH_DEBOUNCE_MS,
  PICKER_SEARCH_HINT,
  PICKER_SEARCH_MIN,
  orderContactMatches,
  type ClientContactValue,
  type ContactMatch,
} from "@/lib/client-contact-choice"
import { cn } from "@/lib/utils"

const FIELD =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"

// A client's own contacts, from the open picker route the quote page uses
// (GET /api/clients/[id])
function useClientContacts(clientId: string | null) {
  const [state, setState] = useState<{ clientId: string; contacts: ContactMatch[] }>({ clientId: "", contacts: [] })
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    fetch(`/api/clients/${clientId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const client = { id: clientId, name: typeof data?.name === "string" ? data.name : "" }
        const contacts: ContactMatch[] = Array.isArray(data?.contacts)
          ? data.contacts.map((c: { id: string; firstName: string; lastName: string; title: string | null; email: string | null }) => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              title: c.title,
              email: c.email,
              client,
            }))
          : []
        setState({ clientId, contacts })
      })
      .catch(() => !cancelled && setState({ clientId, contacts: [] }))
    return () => {
      cancelled = true
    }
  }, [clientId])
  return clientId && state.clientId === clientId ? state.contacts : []
}

// Client and contact chosen together, the way New Quote picks a contact:
// typing in Contact searches every client's contacts by name or email (GET
// /api/contacts/search), the chosen client's own contacts first, and
// picking one also sets its client. Client searches the client list by
// name, and lists nothing until 2 letters are typed (the same hint and
// debounce as Contact). Contact opens on the chosen client's contacts when
// focused. autoFocus focuses one
// when the picker appears (the opportunity page's in place editor). Choosing
// a client that doesn't own the chosen contact clears the contact
// (src/lib/client-contact-choice.ts). Renders the two fields only, so the
// parent lays them out.
export function ClientContactPicker({
  value,
  onChange,
  clients,
  disabled = false,
  required = false,
  labelClassName = "mb-1 block text-sm font-medium text-foreground",
  errors = {},
  autoFocus,
}: {
  value: ClientContactValue
  onChange: (value: ClientContactValue) => void
  // The client list (GET /api/clients), loaded by the parent
  clients: { id: string; name: string }[]
  disabled?: boolean
  required?: boolean
  labelClassName?: string
  errors?: { client?: string; contact?: string }
  // Which search to focus (with its list open) when the picker appears
  autoFocus?: "client" | "contact"
}) {
  return (
    <>
      <ClientSearchField
        value={value}
        onChange={onChange}
        clients={clients}
        disabled={disabled}
        required={required}
        labelClassName={labelClassName}
        error={errors.client}
        autoFocus={autoFocus === "client"}
      />
      <ContactSearchField
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        labelClassName={labelClassName}
        error={errors.contact}
        autoFocus={autoFocus === "contact"}
      />
    </>
  )
}

// Searches the client list by name, like the contact search: nothing is
// listed until at least 2 letters are typed (a hint says so), and the list
// follows the typing after the same short pause. Focused, the text is
// selected so typing replaces it. Arrow keys move, Enter or a click picks,
// Escape closes.
function ClientSearchField({
  value,
  onChange,
  clients,
  disabled,
  required,
  labelClassName,
  error,
  autoFocus,
}: {
  value: ClientContactValue
  onChange: (value: ClientContactValue) => void
  clients: { id: string; name: string }[]
  disabled: boolean
  required: boolean
  labelClassName: string
  error?: string
  autoFocus: boolean
}) {
  const ids = useId()
  const [query, setQuery] = useState<string | null>(null)
  // The text the list follows, a short pause after typing stops
  const [searched, setSearched] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const text = (query ?? "").trim()
  useEffect(() => {
    const timer = setTimeout(() => setSearched(text), PICKER_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const all = value.client && !clients.some((c) => c.id === value.client!.id) ? [value.client, ...clients] : clients
  const searching = text.length >= PICKER_SEARCH_MIN
  const waiting = searching && searched !== text
  // null: fewer than 2 letters typed, so the hint shows instead of a list
  const matched = matchClients(all, waiting ? "" : searched)
  const options = searching && !waiting ? (matched ?? []) : []
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0))

  function pick(client: { id: string; name: string }) {
    onChange(chooseClient(value, { id: client.id, name: client.name }))
    setOpen(false)
    setQuery(null)
  }

  const listId = `${ids}-clients`
  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={`${ids}-client`} className={labelClassName}>
        Client {required && <span className="text-danger">*</span>}
      </label>
      <input
        id={`${ids}-client`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[activeIndex] ? `${listId}-${options[activeIndex].id}` : undefined}
        aria-invalid={!!error}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        value={query ?? value.client?.name ?? ""}
        placeholder="Search clients by name"
        onFocus={(e) => {
          e.currentTarget.select()
          setOpen(true)
          setActive(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
            setActive(Math.min(activeIndex + 1, options.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive(Math.max(activeIndex - 1, 0))
          } else if (e.key === "Enter" && open && options[activeIndex]) {
            e.preventDefault()
            pick(options[activeIndex])
          } else if (e.key === "Escape") {
            setOpen(false)
            setQuery(null)
          }
        }}
        className={FIELD}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover text-sm shadow-popover">
          {!searching ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{PICKER_SEARCH_HINT}</li>
          ) : waiting ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Searching...</li>
          ) : (
            options.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No matching clients.</li>
          )}
          {options.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={c.id === value.client?.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer border-b border-border px-3 py-2 text-foreground last:border-0", i === activeIndex ? "bg-surface-hover" : "")}
            >
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ContactSearchField({
  value,
  onChange,
  disabled,
  required,
  labelClassName,
  error,
  autoFocus,
}: {
  value: ClientContactValue
  onChange: (value: ClientContactValue) => void
  disabled: boolean
  required: boolean
  labelClassName: string
  error?: string
  autoFocus: boolean
}) {
  const ids = useId()
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<{ query: string; matches: ContactMatch[] }>({ query: "", matches: [] })
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const clientContacts = useClientContacts(value.client?.id ?? null)

  const text = query ?? ""
  const searching = text.trim().length >= PICKER_SEARCH_MIN

  // Every client's contacts, from the same search route as New Quote
  useEffect(() => {
    const q = text.trim()
    if (q.length < PICKER_SEARCH_MIN) return
    const timer = setTimeout(() => {
      fetch(`/api/contacts/search?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: ContactSearchResult[]) => setResults({ query: q, matches: Array.isArray(data) ? data : [] }))
        .catch(() => setResults({ query: q, matches: [] }))
    }, PICKER_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const loading = searching && results.query !== text.trim()
  const ownMatches = clientContacts.filter((c) => matchesContactQuery(c, text))
  const options = searching ? orderContactMatches([...ownMatches, ...(loading ? [] : results.matches)], value.client?.id) : ownMatches
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0))

  function pick(match: ContactMatch) {
    onChange(chooseContact(match))
    setOpen(false)
    setQuery(null)
  }

  const listId = `${ids}-contacts`
  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={`${ids}-contact`} className={labelClassName}>
        Contact {required && <span className="text-danger">*</span>}
      </label>
      <input
        id={`${ids}-contact`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[activeIndex] ? `${listId}-${options[activeIndex].id}` : undefined}
        aria-invalid={!!error}
        autoComplete="off"
        disabled={disabled}
        // Shows the chosen contact until the user starts typing
        value={query ?? value.contact?.name ?? ""}
        placeholder={value.client ? `Search ${value.client.name}'s contacts, or any contact` : "Search contacts by name or email"}
        autoFocus={autoFocus}
        onFocus={(e) => {
          // Opens on the chosen client's contacts, the text selected so
          // typing starts a new search
          e.currentTarget.select()
          setOpen(true)
          setActive(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
            setActive(Math.min(activeIndex + 1, options.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive(Math.max(activeIndex - 1, 0))
          } else if (e.key === "Enter" && open && options[activeIndex]) {
            e.preventDefault()
            pick(options[activeIndex])
          } else if (e.key === "Escape") {
            setOpen(false)
            setQuery(null)
          }
        }}
        className={FIELD}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover text-sm shadow-popover">
          {loading && <li className="px-3 py-2 text-xs text-muted-foreground">Searching...</li>}
          {!loading && options.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {searching ? "No matching contacts." : value.client ? "This client has no contacts. Type to search every client." : PICKER_SEARCH_HINT}
            </li>
          )}
          {options.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer border-b border-border px-3 py-2 last:border-0", i === activeIndex ? "bg-surface-hover" : "")}
            >
              <p className="font-medium text-foreground">{contactFullName(c)}</p>
              <p className="text-xs text-muted-foreground">
                {c.client.name}
                {c.title ? `, ${c.title}` : ""}
              </p>
              {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
