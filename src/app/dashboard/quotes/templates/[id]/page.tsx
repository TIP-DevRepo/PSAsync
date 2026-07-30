"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  LineItemBuilder,
  type LineItemBuilderItem,
  type CatalogOption,
} from "@/components/quotes/LineItemBuilder"
import { toast } from "@/lib/toast"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { CollapsibleField } from "@/components/ui/collapsible-field"

interface TemplateDetail {
  id: string
  name: string
  description: string | null
  introText: string | null
  terms: string | null
  expiryDays: number
  active: boolean
  sections: string[]
  useDefaultTerms: boolean
  lineItems: LineItemBuilderItem[]
}

function lineTotal(li: LineItemBuilderItem) {
  return li.unitPrice * li.quantity * (1 - li.discount / 100)
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

export default function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [id, setId] = useState<string | null>(null)
  const [template, setTemplate] = useState<TemplateDetail | null>(null)
  const [catalog, setCatalog] = useState<CatalogOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [companyDefaultTerms, setCompanyDefaultTerms] = useState("")

  useEffect(() => {
    params.then((p) => setId(p.id))
  }, [params])

  function loadTemplate(templateId: string) {
    fetch(`/api/quote-templates/${templateId}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setTemplate(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    if (!id) return
    loadTemplate(id)
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((items: CatalogOption[]) => setCatalog(items.filter((i) => i.active)))
    fetch("/api/quote-settings")
      .then((res) => res.json())
      .then((json) => setCompanyDefaultTerms(json.quoteTerms ?? ""))
  }, [id])

  function update(field: string, value: string | number | boolean) {
    setTemplate((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  async function handleSave() {
    if (!id || !template) return
    setSaving(true)
    const res = await fetch(`/api/quote-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: template.name,
        description: template.description,
        introText: template.introText,
        terms: template.terms,
        useDefaultTerms: template.useDefaultTerms,
        expiryDays: template.expiryDays,
        active: template.active,
      }),
    })
    setSaving(false)
    if (res.ok) {
      toast.success("Template saved")
    } else {
      toast.error("Couldn't save template")
    }
  }

  // ─── Line item mutations (passed into the shared LineItemBuilder) ──────
  async function createLineItem(section: string | null, payload: Partial<LineItemBuilderItem>) {
    if (!id) return
    await fetch(`/api/quote-templates/${id}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, section }),
    })
    loadTemplate(id)
  }

  async function updateLineItem(lineItemId: string, patch: Partial<LineItemBuilderItem>) {
    if (!id) return
    // Optimistic local update so typing feels instant
    setTemplate((prev) =>
      prev
        ? {
            ...prev,
            lineItems: prev.lineItems.map((li) =>
              li.id === lineItemId ? { ...li, ...patch } : li
            ),
          }
        : prev
    )
    await fetch(`/api/quote-templates/${id}/line-items/${lineItemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  }

  async function deleteLineItem(lineItemId: string) {
    if (!id) return
    await fetch(`/api/quote-templates/${id}/line-items/${lineItemId}`, { method: "DELETE" })
    loadTemplate(id)
  }

  async function duplicateLineItem(li: LineItemBuilderItem) {
    if (!id) return
    await fetch(`/api/quote-templates/${id}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: li.section,
        catalogItemId: li.catalogItemId,
        name: li.name,
        description: li.description ?? undefined,
        sku: li.sku ?? undefined,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        cost: li.cost,
        discount: li.discount,
        taxable: li.taxable,
        isRecurring: li.isRecurring,
        recurringInterval: li.recurringInterval ?? undefined,
        isOptional: li.isOptional,
        quantityAdjustable: li.quantityAdjustable,
        choiceGroup: li.choiceGroup ?? undefined,
        isTextBlock: li.isTextBlock,
        bundleName: li.bundleName ?? undefined,
        bundleDisplayMode: li.bundleDisplayMode ?? undefined,
      }),
    })
    loadTemplate(id)
  }

  async function handleAddSection(name: string) {
    if (!id) return
    await fetch(`/api/quote-templates/${id}/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    loadTemplate(id)
  }

  async function handleRemoveSection(name: string) {
    if (!id) return
    await fetch(`/api/quote-templates/${id}/sections`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    loadTemplate(id)
  }

  async function moveItem(section: string | null, itemId: string, direction: "up" | "down") {
    if (!id || !template) return
    const group = template.lineItems
      .filter((li) => (li.section ?? null) === section)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = group.findIndex((li) => li.id === itemId)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= group.length) return

    const a = group[idx]
    const b = group[swapIdx]

    setTemplate((prev) =>
      prev
        ? {
            ...prev,
            lineItems: prev.lineItems.map((li) => {
              if (li.id === a.id) return { ...li, sortOrder: b.sortOrder }
              if (li.id === b.id) return { ...li, sortOrder: a.sortOrder }
              return li
            }),
          }
        : prev
    )

    await Promise.all([
      fetch(`/api/quote-templates/${id}/line-items/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`/api/quote-templates/${id}/line-items/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ])
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading...</p>
  if (notFound || !template) return <p className="text-sm text-red-600">Template not found.</p>

  // ─── Totals (mirrors the quote detail page, minus recurring split by
  // interval since templates don't need that level of preview detail) ────
  const pricedItems = template.lineItems.filter((li) => !li.isTextBlock)
  const subtotal = pricedItems.reduce((sum, li) => sum + lineTotal(li), 0)
  const totalCost = pricedItems.reduce((sum, li) => sum + li.cost * li.quantity, 0)
  const totalMargin = subtotal - totalCost
  const marginPct = subtotal > 0 ? (totalMargin / subtotal) * 100 : 0

  return (
    <div className="w-full space-y-6:">
      <Link href="/dashboard/quotes" className="text-sm text-zinc-500 hover:underline">
        ← Back to Quotes
      </Link>

      <h1 className="text-2xl font-bold">{template.name}</h1>

      <div className="rounded-md border p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Template Name</label>
          <input
            type="text"
            value={template.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <input
            type="text"
            value={template.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Intro Text</label>
          <textarea
            value={template.introText ?? ""}
            onChange={(e) => update("introText", e.target.value)}
            rows={3}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <CollapsibleField label="Terms & Conditions">
          <label className="flex items-center gap-2 text-sm text-foreground mb-2">
            <input
              type="checkbox"
              checked={template.useDefaultTerms}
              onChange={(e) => update("useDefaultTerms", e.target.checked)}
              className="accent-primary"
            />
            Use company default Terms &amp; Conditions
          </label>
          {template.useDefaultTerms ? (
            <div
              className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 last:[&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: companyDefaultTerms || "No company default set." }}
            />
          ) : (
            <RichTextEditor value={template.terms ?? ""} onChange={(html) => update("terms", html)} />
          )}
        </CollapsibleField>
        <div>
          <label className="block text-sm font-medium mb-1">Default Expiry (days)</label>
          <input
            type="number"
            value={template.expiryDays}
            onChange={(e) => update("expiryDays", Number(e.target.value))}
            className="w-32 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={template.active}
            onChange={(e) => update("active", e.target.checked)}
          />
          Active (available when starting a new quote)
        </label>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* Line item builder — same component and behavior as quotes */}
      <div className="space-y-4">
        <h2 className="font-semibold text-lg">Line Items</h2>

        <LineItemBuilder
          items={template.lineItems}
          catalog={catalog}
          locked={false}
          persistedSections={template.sections}
          onAddSection={handleAddSection}
          onRemoveSection={handleRemoveSection}
          onCreate={createLineItem}
          onUpdate={updateLineItem}
          onDelete={deleteLineItem}
          onMove={moveItem}
          onDuplicate={duplicateLineItem}
        />
      </div>

      {/* Totals preview — helps you sanity-check pricing while building
          the template, even though these numbers won't be shown to clients
          until the template is used on a real quote */}
      <div className="rounded-md border p-4 space-y-1 text-sm max-w-md ml-auto">
        <div className="flex justify-between font-semibold">
          <span>Subtotal (preview)</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="border-t mt-2 pt-2 space-y-1 text-zinc-500">
          <div className="flex justify-between">
            <span>Internal: Total Cost</span>
            <span>{money(totalCost)}</span>
          </div>
          <div className="flex justify-between">
            <span>Internal: Total Margin $</span>
            <span>{money(totalMargin)}</span>
          </div>
          <div className="flex justify-between">
            <span>Internal: Margin %</span>
            <span>{subtotal > 0 ? `${marginPct.toFixed(1)}%` : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}