"use client"

import React, { useState, useEffect, useCallback, use } from "react"
import { Button as HeroButton } from "@heroui/react"
import { AcceptFlowModal } from "./AcceptFlowModal"

const pdfButtonStyle = `
  .pdf-download-btn {
    flex-shrink: 0;
    border-radius: 6px;
    border: 1px solid #d4d4d8;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    background: white;
    white-space: nowrap;
    text-decoration: none;
    color: #18181b;
  }
  .pdf-download-btn:hover {
    background: #fafafa;
  }
`

type RecurringInterval = "MONTHLY" | "QUARTERLY" | "ANNUALLY"

interface LineItem {
  id: string
  section: string | null
  sortOrder: number
  name: string
  description: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  discount: number
  taxable: boolean
  isRecurring: boolean
  recurringInterval: RecurringInterval | null
  isOptional: boolean
  optionalSelected: boolean
  quantityAdjustable: boolean
  choiceGroup: string | null
  isTextBlock: boolean
  bundleName: string | null
  bundleDisplayMode: string | null
  isBundleHeader: boolean
}

interface PortalQuote {
  id: string
  quoteNumber: string
  version: number
  status: string
  isInternalPreview: boolean
  title: string | null
  introText: string | null
  terms: string | null
  sections: string[]
  clientPoNumber: string | null
  shipAddress: string | null
  shipCity: string | null
  shipState: string | null
  shipZip: string | null
  shipCountry: string | null
  shipContactName: string | null
  expiresAt: string | null
  taxRate: number
  declineReason: string | null
  portalComment: string | null
  client: { name: string }
  contact: { firstName: string; lastName: string } | null
  user: { name: string; email: string }
  company: {
    name: string
    logoUrl: string | null
    secondaryLogoUrl: string | null
    settings: { primaryColor: string; accentColor: string } | null
  }
  lineItems: LineItem[]
}

const NO_SECTION = "__no_section__"

interface PortalComment {
  id: string
  authorType: "INTERNAL" | "CLIENT"
  authorName: string
  message: string
  createdAt: string
}

function lineTotal(li: LineItem) {
  return li.unitPrice * li.quantity * (1 - li.discount / 100)
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  SENT: { label: "Awaiting Your Review", color: "bg-blue-100 text-blue-700" },
  VIEWED: { label: "Awaiting Your Review", color: "bg-blue-100 text-blue-700" },
  ACCEPTED: { label: "Accepted", color: "bg-green-100 text-green-700" },
  DECLINED: { label: "Declined", color: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Expired", color: "bg-zinc-200 text-zinc-600" },
  DRAFT: { label: "Draft Preview", color: "bg-amber-100 text-amber-700" },
}

export default function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [quote, setQuote] = useState<PortalQuote | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showDeclineForm, setShowDeclineForm] = useState(false)
  const [declineReason, setDeclineReason] = useState("")
  const [comment, setComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [actionMessage, setActionMessage] = useState("")
  const [comments, setComments] = useState<PortalComment[]>([])
  const [showAcceptFlow, setShowAcceptFlow] = useState(false)

  const loadComments = useCallback(() => {
    fetch(`/api/portal/${token}/comments`)
      .then((res) => res.json())
      .then((data) => Array.isArray(data) && setComments(data))
  }, [token])

  const load = useCallback(() => {
    fetch(`/api/portal/${token}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (data) setQuote(data)
        setLoading(false)
      })
  }, [token])

  useEffect(() => {
    load()
    loadComments()
  }, [load, loadComments])

  if (loading) return <div className="p-10 text-center text-zinc-500">Loading your quote...</div>
  if (notFound || !quote)
    return <div className="p-10 text-center text-zinc-500">This quote link is invalid or no longer available.</div>

  const primary = quote.company.settings?.primaryColor ?? "#1B3A5C"
  const accent = quote.company.settings?.accentColor ?? "#2E86AB"
  const statusMeta = STATUS_LABELS[quote.status] ?? { label: quote.status, color: "bg-zinc-100 text-zinc-600" }
  const isLocked = quote.status === "ACCEPTED" || quote.status === "DECLINED" || quote.status === "EXPIRED"
  const showClientActions = !quote.isInternalPreview && !isLocked

  async function toggleOptional(li: LineItem) {
    setQuote((prev) =>
      prev
        ? {
            ...prev,
            lineItems: prev.lineItems.map((x) =>
              x.id === li.id ? { ...x, optionalSelected: !x.optionalSelected } : x
            ),
          }
        : prev
    )
    await fetch(`/api/portal/${token}/line-items/${li.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionalSelected: !li.optionalSelected }),
    })
  }

  async function selectChoice(li: LineItem) {
    setQuote((prev) =>
      prev
        ? {
            ...prev,
            lineItems: prev.lineItems.map((x) => {
              if (x.id === li.id) return { ...x, optionalSelected: true }
              if (x.choiceGroup && x.choiceGroup === li.choiceGroup) return { ...x, optionalSelected: false }
              return x
            }),
          }
        : prev
    )
    await fetch(`/api/portal/${token}/line-items/${li.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionalSelected: true }),
    })
  }

  async function changeQuantity(li: LineItem, newQuantity: number) {
    if (!Number.isFinite(newQuantity) || newQuantity < 0) return
    setQuote((prev) =>
      prev
        ? {
            ...prev,
            lineItems: prev.lineItems.map((x) =>
              x.id === li.id ? { ...x, quantity: newQuantity } : x
            ),
          }
        : prev
    )
    await fetch(`/api/portal/${token}/line-items/${li.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: newQuantity }),
    })
  }

  function renderItemRow(li: LineItem) {
    if (li.isTextBlock) {
      return (
        <tr key={li.id} className="border-b last:border-0">
          <td colSpan={4} className="py-3 px-4">
            <p className="font-semibold text-zinc-900">{li.name}</p>
            {li.description && (
              <p className="text-sm text-zinc-500 whitespace-pre-wrap mt-1">{li.description}</p>
            )}
          </td>
        </tr>
      )
    }
    return (
      <tr key={li.id} className="border-b last:border-0">
        <td className="py-3 pl-4 pr-2 w-8">
          {li.isOptional && showClientActions && (
            li.choiceGroup ? (
              <input
                type="radio"
                name={`choice-${li.choiceGroup}`}
                checked={li.optionalSelected}
                onChange={() => selectChoice(li)}
              />
            ) : (
              <input
                type="checkbox"
                checked={li.optionalSelected}
                onChange={() => toggleOptional(li)}
              />
            )
          )}
        </td>
        <td className="py-3 pr-2">
          <p className="font-medium text-zinc-900">
            {li.name}
            {li.choiceGroup ? (
              <span className="ml-2 text-xs text-zinc-400">(choose one: {li.choiceGroup})</span>
            ) : li.isOptional ? (
              <span className="ml-2 text-xs text-zinc-400">(optional)</span>
            ) : null}
          </p>
          {li.description && (
            <p className="text-xs text-zinc-500">{li.description}</p>
          )}
          {li.isRecurring && (
            <p className="text-xs text-zinc-400">
              Recurring — {li.recurringInterval?.toLowerCase()}
            </p>
          )}
        </td>
        <td className="py-3 pr-2 text-right text-zinc-500 whitespace-nowrap">
          {li.quantityAdjustable && showClientActions ? (
            <span className="inline-flex items-center gap-1">
              <input
                type="number"
                min={0}
                defaultValue={li.quantity}
                onBlur={(e) => changeQuantity(li, Number(e.target.value))}
                className="w-16 rounded border px-2 py-1 text-right text-xs"
              />
              × {money(li.unitPrice)}
            </span>
          ) : (
            <>{li.quantity} × {money(li.unitPrice)}</>
          )}
        </td>
        <td className="py-3 pr-4 text-right font-medium whitespace-nowrap text-zinc-900">
          {li.isOptional && !li.optionalSelected ? (
            <span className="text-zinc-400">Not included</span>
          ) : (
            money(lineTotal(li))
          )}
        </td>
      </tr>
    )
  }

  function handleAcceptedFromModal() {
    setShowAcceptFlow(false)
    setActionMessage("Thank you — this quote has been accepted.")
    load()
  }

  async function handleDecline() {
    setSubmitting(true)
    const res = await fetch(`/api/portal/${token}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: declineReason }),
    })
    if (res.ok) {
      setActionMessage("This quote has been declined.")
      setShowDeclineForm(false)
      load()
    } else {
      const data = await res.json().catch(() => ({}))
      setActionMessage(data.error || "Something went wrong.")
    }
    setSubmitting(false)
  }

  async function handleComment() {
    if (!comment.trim()) return
    setSubmitting(true)
    const res = await fetch(`/api/portal/${token}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: comment }),
    })
    if (res.ok) {
      setComment("")
      loadComments()
    }
    setSubmitting(false)
  }

  // ─── Sections ────────────────────────────────────────────────────────────
  // Same ordering rule as the editor (LineItemBuilder): the persisted
  // sections list is the real, stable order — it only changes when a
  // section is explicitly added/removed, never as a side effect of items
  // moving around. Any section that only exists because a line item
  // references it (no matching entry in quote.sections — e.g. older data
  // from before sections were persisted) is appended after, as a fallback.
  const itemDerivedSections: string[] = []
  quote.lineItems
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((li) => {
      const key = li.section ?? NO_SECTION
      if (!itemDerivedSections.includes(key)) itemDerivedSections.push(key)
    })
  const sectionKeys = [...quote.sections, ...itemDerivedSections].filter(
    (v, i, arr) => arr.indexOf(v) === i
  )

  // ─── Totals (client view — only counted items) ──────────────────────────
  const countedItems = quote.lineItems.filter(
    (li) => !li.isTextBlock && (!li.isOptional || li.optionalSelected)
  )
  const oneTime = countedItems.filter((li) => !li.isRecurring)
  const oneTimeSubtotal = oneTime.reduce((sum, li) => sum + lineTotal(li), 0)
  const taxableOneTime = oneTime.filter((li) => li.taxable).reduce((s, li) => s + lineTotal(li), 0)
  const tax = taxableOneTime * (quote.taxRate / 100)
  const grandTotalOneTime = oneTimeSubtotal + tax

  const recurringByInterval: Record<RecurringInterval, number> = {
    MONTHLY: 0,
    QUARTERLY: 0,
    ANNUALLY: 0,
  }
  countedItems
    .filter((li) => li.isRecurring && li.recurringInterval)
    .forEach((li) => {
      recurringByInterval[li.recurringInterval as RecurringInterval] += lineTotal(li)
    })

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Branded header */}
      <div style={{ backgroundColor: primary }} className="text-white">
        <div className="max-w-3xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(quote.company.secondaryLogoUrl || quote.company.logoUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={quote.company.secondaryLogoUrl || quote.company.logoUrl || ""}
                alt={quote.company.name}
                className="h-10 w-auto"
              />
            )}
            <span className="text-lg font-semibold">{quote.company.name}</span>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusMeta.color}`}>
            {statusMeta.label}
          </span>
        </div>
      </div>

      <style>{pdfButtonStyle}</style>

      {quote.isInternalPreview && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-800 text-sm text-center py-2 font-medium">
          Internal Preview — this link always shows the latest draft and is never sent to the client. Accept/Decline/Comment actions are disabled here.
        </div>
      )}

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">
              {quote.quoteNumber}
              {quote.version > 1 && (
                <span className="text-base font-normal text-zinc-400"> v{quote.version}</span>
              )}
            </h1>
            {quote.title && <p className="text-zinc-600">{quote.title}</p>}
            <p className="text-sm text-zinc-500 mt-1">
              Prepared for {quote.client.name}
              {quote.contact ? ` — ${quote.contact.firstName} ${quote.contact.lastName}` : ""} by{" "}
              {quote.user.name}
            </p>
            {quote.expiresAt && (
              <p className="text-sm text-zinc-500">
                Valid until {new Date(quote.expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>
          
            <a href={`/api/portal/${token}/pdf`} target="_blank" rel="noopener noreferrer" className="pdf-download-btn">
            Download PDF
          </a>
        </div>

        {quote.introText && (
          <div className="rounded-md border bg-white p-4 text-sm text-zinc-700 whitespace-pre-wrap">
            {quote.introText}
          </div>
        )}

        {/* Line items */}
        <div className="space-y-4">
          {sectionKeys.map((sectionKey) => {
            const items = quote.lineItems
              .filter((li) => (li.section ?? NO_SECTION) === sectionKey)
              .sort((a, b) => a.sortOrder - b.sortOrder)

            // Group by bundle header so a collapsed bundle renders as one
            // summary row, and itemized bundles show a small heading above
            // their members
            const seenBundles = new Set<string>()
            const groups: {
              key: string
              header: LineItem | null
              bundleItems: LineItem[] | null
              item: LineItem | null
            }[] = []
            items.forEach((li) => {
              if (li.isBundleHeader) {
                if (!li.bundleName || seenBundles.has(li.bundleName)) return
                seenBundles.add(li.bundleName)
                const members = items.filter((x) => x.bundleName === li.bundleName && !x.isBundleHeader)
                groups.push({ key: `bundle-${li.id}`, header: li, bundleItems: members, item: null })
              } else if (li.bundleName && items.some((x) => x.isBundleHeader && x.bundleName === li.bundleName)) {
                // Will be rendered as part of its header's group above
                return
              } else {
                groups.push({ key: li.id, header: null, bundleItems: null, item: li })
              }
            })

            return (
              <div key={sectionKey} className="rounded-md border bg-white overflow-hidden">
                <div
                  className="px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: accent }}
                >
                  {sectionKey === NO_SECTION ? "Items" : sectionKey}
                </div>
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: "32px" }} />
                    <col />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "110px" }} />
                  </colgroup>
                  <tbody>
                    {groups.map((g) => {
                      if (g.bundleItems && g.header) {
                        const mode = g.header.bundleDisplayMode ?? "COLLAPSED"
                        const counted = g.bundleItems.filter((x) => !x.isOptional || x.optionalSelected)
                        const bundleTotal = counted.reduce((sum, x) => sum + lineTotal(x), 0)

                        if (mode !== "ITEMIZED") {
                          // Collapsed: still list every item's name so the
                          // client can see exactly what's included, but hide
                          // per-item pricing — only the bundle's combined
                          // total is shown, on the header row
                          return (
                            <React.Fragment key={g.key}>
                              <tr className="border-b bg-zinc-50">
                                <td className="py-3 pl-4 pr-2 w-8"></td>
                                <td className="py-3 pr-2" colSpan={2}>
                                  <p className="font-medium text-zinc-900">{g.header.name}</p>
                                </td>
                                <td className="py-3 pr-4 text-right font-medium whitespace-nowrap text-zinc-900">
                                  {money(bundleTotal)}
                                </td>
                              </tr>
                              {g.bundleItems.map((li) => (
                                <tr key={li.id} className="border-b last:border-0">
                                  <td className="py-2 pl-4 pr-2 w-8"></td>
                                  <td className="py-2 pl-6 pr-2 text-zinc-600" colSpan={2}>
                                    {li.name}
                                    {li.isOptional && !li.optionalSelected && (
                                      <span className="ml-2 text-xs text-zinc-400">(not included)</span>
                                    )}
                                  </td>
                                  <td className="py-2 pr-4 text-right text-zinc-400">—</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          )
                        }

                        // Itemized: each item shows its own price
                        return (
                          <React.Fragment key={g.key}>
                            <tr className="border-b">
                              <td colSpan={4} className="py-2 pl-4 text-xs font-semibold text-zinc-500">
                                {g.header.name}
                              </td>
                            </tr>
                            {g.bundleItems.map((li) => renderItemRow(li))}
                          </React.Fragment>
                        )
                      }
                      return renderItemRow(g.item as LineItem)
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>

        {/* Totals */}
        <div className="rounded-md border bg-white p-4 space-y-1 text-sm max-w-md ml-auto text-zinc-900">
          <div className="flex justify-between">
            <span className="text-zinc-500">Subtotal</span>
            <span>{money(oneTimeSubtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Tax ({quote.taxRate}%)</span>
            <span>{money(tax)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1">
            <span>Total (One-Time)</span>
            <span>{money(grandTotalOneTime)}</span>
          </div>
          {recurringByInterval.MONTHLY > 0 && (
            <div className="flex justify-between pt-2">
              <span className="text-zinc-500">Monthly</span>
              <span>{money(recurringByInterval.MONTHLY)}</span>
            </div>
          )}
          {recurringByInterval.QUARTERLY > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Quarterly</span>
              <span>{money(recurringByInterval.QUARTERLY)}</span>
            </div>
          )}
          {recurringByInterval.ANNUALLY > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Annual</span>
              <span>{money(recurringByInterval.ANNUALLY)}</span>
            </div>
          )}
        </div>

        {quote.terms && (
          <div className="rounded-md border bg-white p-4 text-xs text-zinc-500">
            <p className="font-medium text-zinc-700 mb-1">Terms &amp; Conditions</p>
            <div
              className="[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 last:[&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: quote.terms }}
            />
          </div>
        )}

        {/* Actions */}
        {actionMessage && (
          <div className="rounded-md border bg-white p-3 text-sm text-center text-zinc-900">{actionMessage}</div>
        )}

        {showClientActions && (
          <div className="rounded-md border bg-white p-4 space-y-3">
            {!showDeclineForm ? (
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowAcceptFlow(true)}
                  disabled={submitting}
                  style={{ backgroundColor: primary }}
                  className="rounded-md px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Accept Quote
                </button>
                <button
                  onClick={() => setShowDeclineForm(true)}
                  disabled={submitting}
                  className="rounded-md border px-6 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-900">
                  Let us know why (optional)
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowDeclineForm(false)}
                    className="rounded-md border px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDecline}
                    disabled={submitting}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Confirm Decline
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isLocked && quote.status === "DECLINED" && quote.declineReason && (
          <div className="rounded-md border bg-white p-4 text-sm">
            <p className="font-medium mb-1 text-zinc-900">Decline reason</p>
            <p className="text-zinc-600">{quote.declineReason}</p>
          </div>
        )}

        {/* Comments thread */}
        <div className="rounded-md border bg-white p-4 space-y-3">
          <label className="block text-sm font-medium text-zinc-900">Messages</label>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {comments.length === 0 && (
              <p className="text-sm text-zinc-500">No messages yet — ask a question below.</p>
            )}
            {comments.map((c) => (
              <div
                key={c.id}
                className={`rounded-md p-3 text-sm max-w-[85%] ${
                  c.authorType === "CLIENT"
                    ? "bg-zinc-100 ml-auto"
                    : "bg-blue-50"
                }`}
              >
                <p className="text-xs font-medium text-zinc-500 mb-1">
                  {c.authorName} · {new Date(c.createdAt).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap text-zinc-900">{c.message}</p>
              </div>
            ))}
          </div>
          {!quote.isInternalPreview && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Type your message here..."
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <div className="flex justify-end">
                <HeroButton
                  variant="primary"
                  onPress={handleComment}
                  isDisabled={submitting || !comment.trim()}
                >
                  Send
                </HeroButton>
              </div>
            </>
          )}
        </div>
      </div>

      {showAcceptFlow && (
        <AcceptFlowModal
          token={token}
          terms={quote.terms}
          primaryColor={primary}
          defaultSignerName={
            quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}` : quote.client.name
          }
          defaultClientPoNumber={quote.clientPoNumber}
          defaultShipContactName={quote.shipContactName || (quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}` : quote.client.name)}
          defaultShipAddress={quote.shipAddress}
          defaultShipCity={quote.shipCity}
          defaultShipState={quote.shipState}
          defaultShipZip={quote.shipZip}
          defaultShipCountry={quote.shipCountry}
          onClose={() => setShowAcceptFlow(false)}
          onAccepted={handleAcceptedFromModal}
        />
      )}
    </div>
  )
}