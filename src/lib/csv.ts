import Papa from "papaparse"

// ─── Shared CSV Import/Export Engine ───────────────────────────────────────
// Generic helpers used by every page that adds import/export (Clients first,
// Vendors/Inventory/etc. later). No entity-specific logic lives here — that
// belongs in each page's own config file (e.g. clientsConfig.ts).

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

// Reads a CSV file the user uploaded and returns its headers + rows.
// Every cell comes back as a string — turning "5" into a number, or
// validating required fields, happens later in the entity-specific step.
export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? []
        resolve({ headers, rows: results.data })
      },
      error: (err: Error) => reject(err),
    })
  })
}

// Turns an array of plain objects into CSV text, using the exact column
// order given in `headers`. Missing fields on a row just come out blank.
export function rowsToCsv(rows: Record<string, unknown>[], headers: string[]): string {
  return Papa.unparse({
    fields: headers,
    data: rows.map((row) => headers.map((h) => row[h] ?? "")),
  })
}

// Triggers a browser download of the given CSV text as a file.
export function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Builds a blank template CSV — just the header row — so users know the
// exact column names/order the system expects before filling one in.
export function generateTemplateCsv(headers: string[]): string {
  return Papa.unparse({ fields: headers, data: [] })
}