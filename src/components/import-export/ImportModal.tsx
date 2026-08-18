"use client"

import { useState, useRef } from "react"
import { Upload, FileText, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { parseCsvFile, type ParsedCsv } from "@/lib/csv"

// ─── Shared Import Modal ────────────────────────────────────────────────
// Generic 4-step flow: Upload -> Map Columns -> Preview -> Results.
// Entity-specific pages (Clients, Vendors, etc.) supply `fields` (what can
// be mapped to) and `onImport` (what actually happens with the mapped
// rows). This component has no idea what a "Client" is.

export interface ImportFieldConfig {
  key: string // internal field name, e.g. "name"
  label: string // shown to the user, e.g. "Client Name"
  required?: boolean
}

export interface ImportResult {
  createdCount: number
  skipped: { rowNumber: number; reason: string }[]
}

type Step = "upload" | "map" | "preview" | "importing" | "results"

export function ImportModal({
  entityLabel,
  fields,
  onImport,
  onClose,
  onComplete,
}: {
  entityLabel: string // e.g. "Clients"
  fields: ImportFieldConfig[]
  onImport: (rows: Record<string, string>[]) => Promise<ImportResult>
  onClose: () => void
  onComplete: () => void
}) {
  const [step, setStep] = useState<Step>("upload")
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({}) // fieldKey -> csvHeader
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(file: File) {
    setError(null)
    try {
      const data = await parseCsvFile(file)
      if (data.rows.length === 0) {
        setError("That CSV file doesn't have any data rows in it.")
        return
      }
      setParsed(data)

      // Best-effort auto-mapping: if a CSV header matches a field's label
      // or key (case-insensitive), pre-fill it so the user has less to do.
      const autoMap: Record<string, string> = {}
      fields.forEach((f) => {
        const match = data.headers.find(
          (h) => h.toLowerCase() === f.label.toLowerCase() || h.toLowerCase() === f.key.toLowerCase()
        )
        if (match) autoMap[f.key] = match
      })
      setMapping(autoMap)
      setStep("map")
    } catch {
      setError("Couldn't read that file. Make sure it's a valid CSV.")
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelected(file)
  }

  const requiredFieldsMapped = fields.filter((f) => f.required).every((f) => mapping[f.key])

  async function handleConfirmImport() {
    if (!parsed) return
    setStep("importing")
    // Re-shape each CSV row from "csv header -> value" into "field key -> value"
    // using the mapping the user chose.
    const mappedRows = parsed.rows.map((row) => {
      const out: Record<string, string> = {}
      fields.forEach((f) => {
        const csvHeader = mapping[f.key]
        out[f.key] = csvHeader ? row[csvHeader] ?? "" : ""
      })
      return out
    })

    try {
      const res = await onImport(mappedRows)
      setResult(res)
      setStep("results")
    } catch {
      setError("The import failed partway through. No records were saved — please try again.")
      setStep("preview")
    }
  }

  return (
    <Modal maxWidth="lg" onClose={onClose}>
      <h2 className="text-lg font-bold text-foreground">Import {entityLabel}</h2>

      {/* ── Step 1: Upload ── */}
      {step === "upload" && (
        <div className="mt-4 space-y-3">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-lg border-2 border-dashed border-border bg-card/50 p-10 text-center transition-colors hover:border-primary hover:bg-card"
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">Click to choose a CSV file, or drag one here</p>
            <p className="mt-1 text-xs text-muted-foreground">Only .csv files are supported.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileSelected(file)
            }}
          />
          {error && (
            <p className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>
      )}

      {/* ── Step 2: Map Columns ── */}
      {step === "map" && parsed && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Match each field to a column from your CSV file. Fields marked with{" "}
            <span className="text-danger">*</span> are required.
          </p>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="w-40 shrink-0 text-sm text-foreground">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Don&apos;t import —</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={() => setStep("upload")}>
              Back
            </Button>
            <Button size="sm" disabled={!requiredFieldsMapped} onClick={() => setStep("preview")}>
              Next: Preview <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Preview ── */}
      {step === "preview" && parsed && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Found <span className="font-medium text-foreground">{parsed.rows.length}</span> row
            {parsed.rows.length === 1 ? "" : "s"}. Here&apos;s a preview of the first 5:
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-card text-left text-muted-foreground">
                  {fields.filter((f) => mapping[f.key]).map((f) => (
                    <th key={f.key} className="py-2 px-3 font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {fields.filter((f) => mapping[f.key]).map((f) => (
                      <td key={f.key} className="py-2 px-3 text-foreground">
                        {row[mapping[f.key]] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <p className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" onClick={() => setStep("map")}>
              Back
            </Button>
            <Button size="sm" onClick={handleConfirmImport}>
              Import {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Importing ── */}
      {step === "importing" && (
        <div className="mt-8 flex flex-col items-center gap-3 py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Importing, please wait...</p>
        </div>
      )}

      {/* ── Step 5: Results ── */}
      {step === "results" && result && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg p-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            <p className="text-sm text-foreground">
              <span className="font-medium">{result.createdCount}</span> record
              {result.createdCount === 1 ? "" : "s"} imported successfully.
            </p>
          </div>
          {result.skipped.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" /> {result.skipped.length} row
                {result.skipped.length === 1 ? "" : "s"} skipped:
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-card text-left text-muted-foreground">
                      <th className="py-2 px-3 font-medium">Row</th>
                      <th className="py-2 px-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s) => (
                      <tr key={s.rowNumber} className="border-b border-border last:border-0">
                        <td className="py-2 px-3 text-foreground">{s.rowNumber}</td>
                        <td className="py-2 px-3 text-muted-foreground">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              onClick={() => {
                onComplete()
                onClose()
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}