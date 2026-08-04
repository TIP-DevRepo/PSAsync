"use client"

import { useState, useEffect, useRef } from "react"

export interface ContactSearchResult {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phone: string | null
  client: {
    id: string
    name: string
    email: string | null
    phone: string | null
    paymentTerms: string | null
    mainBillingLocation: {
      name: string
      address: string | null
      address2: string | null
      city: string | null
      state: string | null
      zip: string | null
      country: string | null
    } | null
    mainShippingLocation: {
      name: string
      address: string | null
      address2: string | null
      city: string | null
      state: string | null
      zip: string | null
      country: string | null
    } | null
  }
}

interface ContactSearchInputProps {
  onSelect: (contact: ContactSearchResult) => void
  placeholder?: string
}

// Reusable "search a contact by name/email/phone/company, pick one from a
// dropdown" input. Debounced, no controlled selected-value state of its
// own — the parent owns what happens after a selection (autofill, etc.),
// this component just handles the search + pick interaction.
export function ContactSearchInput({ onSelect, placeholder }: ContactSearchInputProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ContactSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    const timeout = setTimeout(() => {
      fetch(`/api/contacts/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data: ContactSearchResult[]) => {
          setResults(data)
          setOpen(true)
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }, 300)
    return () => clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function handleSelect(contact: ContactSearchResult) {
    setQuery(`${contact.firstName} ${contact.lastName}`)
    setOpen(false)
    onSelect(contact)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder ?? "Search by name, email, phone, or company..."}
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-white dark:bg-zinc-900 shadow-md max-h-72 overflow-y-auto">
          {loading && <p className="px-3 py-2 text-xs text-zinc-500">Searching...</p>}
          {!loading && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">No matches.</p>
          )}
          {!loading &&
            results.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelect(c)}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b last:border-0"
              >
                <p className="font-medium">
                  {c.firstName} {c.lastName}
                </p>
                <p className="text-xs text-zinc-500">{c.client.name}</p>
                {c.email && <p className="text-xs text-zinc-400">{c.email}</p>}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}