"use client"

import { FileDown } from "lucide-react"
import { generateTemplateCsv, downloadCsv } from "@/lib/csv"

// Shared "Download CSV Template" link. Gives the user a blank CSV with
// just the correct column headers, so they know the expected format
// before filling one in and uploading it to ImportModal.

export function DownloadTemplateButton({
  filename,
  headers,
}: {
  filename: string
  headers: string[]
}) {
  function handleClick() {
    const csv = generateTemplateCsv(headers)
    downloadCsv(filename, csv)
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      <FileDown className="h-3.5 w-3.5" />
      Download CSV template
    </button>
  )
}