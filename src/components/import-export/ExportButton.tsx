"use client"

import { useState, useRef, useEffect } from "react"
import { Download, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { rowsToCsv, downloadCsv } from "@/lib/csv"

// Shared Export Button. Any list page can drop this in and pass it the
// rows currently on screen plus the full unfiltered set. The user picks
// which one they want at click time. No entity-specific logic lives here.

export function ExportButton({
  filename,
  headers,
  visibleRows,
  allRows,
}: {
  filename: string
  headers: string[]
  visibleRows: Record<string, unknown>[]
  allRows: Record<string, unknown>[]
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function handleExport(rows: Record<string, unknown>[]) {
    const csv = rowsToCsv(rows, headers)
    downloadCsv(filename, csv)
    setOpen(false)
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Export
        <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-52 rounded-md border border-border bg-card shadow-card">
          <button
            onClick={() => handleExport(visibleRows)}
            className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            Export visible rows ({visibleRows.length})
          </button>
          <button
            onClick={() => handleExport(allRows)}
            className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            Export all rows ({allRows.length})
          </button>
        </div>
      )}
    </div>
  )
}