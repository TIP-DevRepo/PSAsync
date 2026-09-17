"use client"

import { useState, useEffect } from "react"

export interface AdditionalDetailsValue {
  warrantyType: string
  warrantyExpiration: string
  overrideVendorId: string
  overrideVendorSku: string
  overrideManufacturerId: string
  overrideManufacturerSku: string
  notes: string
  customFieldValues: Record<string, string>
}

export const EMPTY_ADDITIONAL_DETAILS: AdditionalDetailsValue = {
  warrantyType: "",
  warrantyExpiration: "",
  overrideVendorId: "",
  overrideVendorSku: "",
  overrideManufacturerId: "",
  overrideManufacturerSku: "",
  notes: "",
  customFieldValues: {},
}

interface VendorOption {
  id: string
  name: string
  isVendor: boolean
  isManufacturer: boolean
}
interface CustomFieldOption {
  id: string
  name: string
  categoryId: string
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"

// Warranty, Vendor/Manufacturer overrides, Notes, and Custom Field values —
// the InventoryAsset fields that apply regardless of status/ownership and
// have no dedicated action modal of their own. Shared between the manual
// Add Inventory Item form (always editable) and the asset Details tab
// (rendered permanently, but disabled until its own Edit button is
// clicked), so the two never drift out of sync.
export function AssetAdditionalDetailsFields({
  value,
  onChange,
  categoryId,
  disabled = false,
}: {
  value: AdditionalDetailsValue
  onChange: (next: AdditionalDetailsValue) => void
  categoryId: string | null
  disabled?: boolean
}) {
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [customFields, setCustomFields] = useState<CustomFieldOption[]>([])

  useEffect(() => {
    fetch("/api/vendors")
      .then((res) => res.json())
      .then((data: VendorOption[]) => Array.isArray(data) && setVendors(data))
    fetch("/api/inventory-custom-fields")
      .then((res) => res.json())
      .then((data: CustomFieldOption[]) => Array.isArray(data) && setCustomFields(data))
  }, [])

  const matchingCustomFields = categoryId ? customFields.filter((f) => f.categoryId === categoryId) : []

  function update<K extends keyof AdditionalDetailsValue>(key: K, val: AdditionalDetailsValue[K]) {
    onChange({ ...value, [key]: val })
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
      <p className="text-sm font-medium text-foreground">Additional Details</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Warranty Type</label>
          <input type="text" value={value.warrantyType} onChange={(e) => update("warrantyType", e.target.value)} disabled={disabled} className={SELECT_CLASS} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Warranty Expiration</label>
          <input type="date" value={value.warrantyExpiration} onChange={(e) => update("warrantyExpiration", e.target.value)} disabled={disabled} className={SELECT_CLASS} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Vendor</label>
          <select value={value.overrideVendorId} onChange={(e) => update("overrideVendorId", e.target.value)} disabled={disabled} className={SELECT_CLASS}>
            <option value="">Not set</option>
            {vendors.filter((v) => v.isVendor).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Vendor SKU</label>
          <input type="text" value={value.overrideVendorSku} onChange={(e) => update("overrideVendorSku", e.target.value)} disabled={disabled} className={SELECT_CLASS} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Manufacturer</label>
          <select value={value.overrideManufacturerId} onChange={(e) => update("overrideManufacturerId", e.target.value)} disabled={disabled} className={SELECT_CLASS}>
            <option value="">Not set</option>
            {vendors.filter((v) => v.isManufacturer).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Manufacturer SKU</label>
          <input type="text" value={value.overrideManufacturerSku} onChange={(e) => update("overrideManufacturerSku", e.target.value)} disabled={disabled} className={SELECT_CLASS} />
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Notes</label>
        <textarea value={value.notes} onChange={(e) => update("notes", e.target.value)} disabled={disabled} rows={2} className={SELECT_CLASS} />
      </div>

      {categoryId && matchingCustomFields.length > 0 && (
        <div className="space-y-3 border-t border-border pt-3">
          {matchingCustomFields.map((f) => (
            <div key={f.id}>
              <label className="block text-xs text-muted-foreground mb-1">{f.name}</label>
              <input
                type="text"
                value={value.customFieldValues[f.id] ?? ""}
                onChange={(e) => update("customFieldValues", { ...value.customFieldValues, [f.id]: e.target.value })}
                disabled={disabled}
                className={SELECT_CLASS}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Converts the controlled value into the shape both the create (POST) and
// edit (PATCH) API routes expect. Only non-blank custom field entries are
// included — the fields component only ever writes keys for whichever
// Catalog Item category is currently selected, so this doesn't need to
// re-filter by category itself.
export function additionalDetailsToBody(value: AdditionalDetailsValue) {
  return {
    warrantyType: value.warrantyType.trim() || null,
    warrantyExpiration: value.warrantyExpiration || null,
    overrideVendorId: value.overrideVendorId || null,
    overrideVendorSku: value.overrideVendorSku.trim() || null,
    overrideManufacturerId: value.overrideManufacturerId || null,
    overrideManufacturerSku: value.overrideManufacturerSku.trim() || null,
    notes: value.notes.trim() || null,
    customFieldValues: Object.entries(value.customFieldValues)
      .map(([customFieldId, val]) => ({ customFieldId, value: val.trim() }))
      .filter((v) => v.value),
  }
}
