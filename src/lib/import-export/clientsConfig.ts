import type { ImportFieldConfig } from "@/components/import-export/ImportModal"

// ─── Clients Import/Export Config ──────────────────────────────────────
// Defines the fields available for Client CSV import/export/templates.
// Only flat fields are included (no linked records like Industry) per
// the decision to defer cross-table lookups until Inventory needs them.

export const CLIENT_IMPORT_FIELDS: ImportFieldConfig[] = [
  { key: "name", label: "Company Name", required: true },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "status", label: "Status" },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "notes", label: "Notes" },
]

export const CLIENT_EXPORT_HEADERS = CLIENT_IMPORT_FIELDS.map((f) => f.label)

// Turns a Client record from the API into a flat row keyed by label,
// ready to hand to the shared CSV export helper.
export function clientToExportRow(client: {
  name: string
  email: string | null
  phone: string | null
  website?: string | null
  status: string
  paymentTerms?: string | null
  notes?: string | null
}): Record<string, unknown> {
  return {
    "Company Name": client.name,
    Email: client.email ?? "",
    Phone: client.phone ?? "",
    Website: client.website ?? "",
    Status: client.status,
    "Payment Terms": client.paymentTerms ?? "",
    Notes: client.notes ?? "",
  }
}