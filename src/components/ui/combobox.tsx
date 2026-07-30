"use client"

import { useState, useRef, useEffect } from "react"
import { Check, ChevronDown, Plus } from "lucide-react"

export interface ComboboxOption {
  id: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (id: string) => void
  onCreate: (label: string) => Promise<ComboboxOption>
  placeholder?: string
  emptyLabel?: string
}

// A searchable, creatable single-select dropdown. Built custom rather than
// pulled from a library since nothing like this exists in the project yet
// and the need is narrow (single-select, flat list).
export function Combobox({ options, value, onChange, onCreate, placeholder, emptyLabel = "None" }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.id === value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
  const exactMatch = options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase())

  function handleOpen() {
    setOpen(true)
    setQuery("")
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleSelect(id: string) {
    onChange(id)
    setOpen(false)
    setQuery("")
  }

  async function handleCreate() {
    const label = query.trim()
    if (!label) return
    setCreating(true)
    try {
      const created = await onCreate(label)
      onChange(created.id)
      setOpen(false)
      setQuery("")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {!open ? (
        <button
          type="button"
          onClick={handleOpen}
          className="w-full flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={selected ? "text-foreground" : "text-muted-foreground"}>
            {selected ? selected.label : emptyLabel}
          </span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false)
              setQuery("")
            }
            if (e.key === "Enter") {
              e.preventDefault()
              if (filtered.length === 1) {
                handleSelect(filtered[0].id)
              } else if (!exactMatch && query.trim()) {
                handleCreate()
              }
            }
          }}
          placeholder={placeholder ?? "Search or create..."}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-popover max-h-56 overflow-y-auto text-sm">
          <button
            type="button"
            onClick={() => handleSelect("")}
            className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-hover"
          >
            <span className="text-muted-foreground">{emptyLabel}</span>
            {!value && <Check size={14} className="text-primary" />}
          </button>
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => handleSelect(o.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-foreground hover:bg-surface-hover"
            >
              {o.label}
              {value === o.id && <Check size={14} className="text-primary" />}
            </button>
          ))}
          {filtered.length === 0 && !query && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No options yet — type to create one.</p>
          )}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-primary hover:bg-surface-hover"
            >
              <Plus size={14} />
              {creating ? "Creating..." : `Create "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}