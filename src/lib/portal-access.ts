import { NextResponse } from "next/server"
import type { QuoteStatus } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isPastExpiry, PORTAL_EXPIRY_TIME_ZONE } from "@/lib/quote-expiry"

// The one set of rules for the customer portal. Every portal route
// (GET portal/[token], comments, accept, decline, line-items, pdf) starts
// with resolvePortalAccess, which works out which quote a token opens and
// whether this use of it is allowed.
//
// Two kinds of token:
// - The client token (accessToken) is what the customer gets. It opens a
//   version that was actually sent, until the quote expires.
// - The internal token (internalAccessToken) is the staff "open portal"
//   preview of the newest version, drafts included. It never marks a quote
//   viewed, never notifies anyone, ignores expiry, and refuses every action.

// A sent version the customer may open. DRAFT and PENDING_APPROVAL mean the
// quote was pulled back (or never went out), so its link does not open.
export const CLIENT_VIEWABLE_STATUSES: readonly QuoteStatus[] = ["SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"]

// Waiting on the customer: only now may they accept, decline, comment, or
// change optional items and quantities
export const AWAITING_RESPONSE_STATUSES: readonly QuoteStatus[] = ["SENT", "VIEWED"]

// Past its expiry date a link stops working, except for these statuses,
// which keep a view-only link (the page and the PDF; every action is
// refused). An accepted quote stays viewable so the customer can still see
// what they signed.
export const VIEW_AFTER_EXPIRY_STATUSES: readonly QuoteStatus[] = ["ACCEPTED"]

export const LINK_INVALID_MESSAGE = "This link is no longer valid"
export const QUOTE_EXPIRED_MESSAGE = "This quote has expired"
export const SUPERSEDED_MESSAGE = "A newer version of this quote has been sent"

// "view" reads (the page, its comments, the PDF); "act" changes something
// (accept, decline, comment, line item updates)
export type PortalUse = "view" | "act"
export type TokenKind = "client" | "internal"

export interface PortalQuoteState {
  status: QuoteStatus
  sentAt: Date | null
  expiresAt: Date | null
}

// The date rule lives in src/lib/quote-expiry.ts: a date only expiresAt is
// valid through the end of that day in PORTAL_EXPIRY_TIME_ZONE, a real
// time is compared as is, and null never expires
export { isPastExpiry, PORTAL_EXPIRY_TIME_ZONE }

export function isExpired(quote: PortalQuoteState, now: Date): boolean {
  return quote.status === "EXPIRED" || isPastExpiry(quote.expiresAt, now)
}

// Whether a version's client token opens at all: it was sent and has not
// been moved back to draft
export function clientLinkOpens(quote: Pick<PortalQuoteState, "status" | "sentAt">): boolean {
  return !!quote.sentAt && CLIENT_VIEWABLE_STATUSES.includes(quote.status)
}

export type PortalDecision =
  | { ok: true; expired: boolean }
  | { ok: false; status: 400 | 403 | 404 | 410; error: string; code: string }

// Pure decision for one quote, one token kind, and one use. superseded
// (see isSupersededVersion) only refuses actions, after every other rule,
// so an older version keeps its view, its PDF, and its expiry and status
// answers.
export function decidePortalAccess(
  quote: PortalQuoteState,
  kind: TokenKind,
  use: PortalUse,
  now: Date,
  superseded = false
): PortalDecision {
  if (kind === "internal") {
    if (use === "view") return { ok: true, expired: isExpired(quote, now) }
    return { ok: false, status: 403, code: "INTERNAL_PREVIEW", error: "Actions are turned off in the internal preview" }
  }

  if (!clientLinkOpens(quote)) return { ok: false, status: 404, code: "LINK_INVALID", error: LINK_INVALID_MESSAGE }

  if (isExpired(quote, now)) {
    if (use === "view" && VIEW_AFTER_EXPIRY_STATUSES.includes(quote.status)) return { ok: true, expired: true }
    return { ok: false, status: 410, code: "QUOTE_EXPIRED", error: QUOTE_EXPIRED_MESSAGE }
  }

  if (use === "act" && !AWAITING_RESPONSE_STATUSES.includes(quote.status)) {
    const responded = quote.status === "ACCEPTED" || quote.status === "DECLINED"
    return {
      ok: false,
      status: 400,
      code: "NOT_AWAITING_RESPONSE",
      error: responded ? "This quote has already been responded to" : "This quote is not awaiting a response",
    }
  }

  if (use === "act" && superseded) {
    return { ok: false, status: 400, code: "SUPERSEDED", error: SUPERSEDED_MESSAGE }
  }

  return { ok: true, expired: false }
}

export function linkInvalidResponse() {
  return NextResponse.json({ error: LINK_INVALID_MESSAGE, code: "LINK_INVALID" }, { status: 404 })
}

// Both token formats ever issued: cuid (the schema default) and 43
// character base64url (newAccessToken). Anything else is refused without a
// database lookup.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,64}$/

const stateSelect = {
  id: true,
  companyId: true,
  quoteNumber: true,
  status: true,
  sentAt: true,
  expiresAt: true,
  isActive: true,
} as const

type StateRow = PortalQuoteState & { id: string; companyId: string; quoteNumber: string; isActive: boolean }

// Each version of a quote is its own row with its own client token. The
// family's active version (isActive, moved by every send and by
// reactivate) is the live one. A version the customer opens is superseded
// when it is not active and a different version is active and was sent, so
// an older link can still be read but not acted on. A family whose active
// version was never sent (reactivating a draft) supersedes nothing, so
// those links keep working as before.
export function isSupersededVersion(
  version: { id: string; isActive: boolean },
  activeSentVersionId: string | null
): boolean {
  return !version.isActive && !!activeSentVersionId && activeSentVersionId !== version.id
}

// Only looked up for a version that is not the active one, so the link to
// the live version never pays for this query
async function findActiveSentVersionId(quote: StateRow): Promise<string | null> {
  if (quote.isActive) return null
  const active = await prisma.quote.findFirst({
    where: { companyId: quote.companyId, quoteNumber: quote.quoteNumber, isActive: true, sentAt: { not: null } },
    select: { id: true },
  })
  return active?.id ?? null
}

// Which version a token opens, before the rules are applied.
// A client token opens its own version when that version was sent. A
// client token of a version that was never sent (a revision still being
// drafted, or one linked from a staff comment email) opens the family's
// most recently sent version instead, as it always has, and nothing when
// none was sent. The unsent version itself is never shown.
// An internal token opens the family's newest version.
async function findTokenQuote(token: string, allowInternal: boolean): Promise<{ quote: StateRow; kind: TokenKind } | null> {
  if (!TOKEN_SHAPE.test(token)) return null

  const matched = await prisma.quote.findUnique({ where: { accessToken: token }, select: stateSelect })
  if (matched) {
    if (matched.sentAt) return { quote: matched, kind: "client" }
    const lastSent = await prisma.quote.findFirst({
      where: { companyId: matched.companyId, quoteNumber: matched.quoteNumber, sentAt: { not: null } },
      orderBy: { version: "desc" },
      select: stateSelect,
    })
    return lastSent ? { quote: lastSent, kind: "client" } : { quote: matched, kind: "client" }
  }

  if (!allowInternal) return null
  const internal = await prisma.quote.findUnique({ where: { internalAccessToken: token }, select: stateSelect })
  if (!internal) return null
  const newest = await prisma.quote.findFirst({
    where: { companyId: internal.companyId, quoteNumber: internal.quoteNumber },
    orderBy: { version: "desc" },
    select: stateSelect,
  })
  return { quote: newest ?? internal, kind: "internal" }
}

export type PortalAccess =
  | {
      ok: true
      quoteId: string
      status: QuoteStatus
      isInternal: boolean
      expired: boolean
      // A newer version was sent: reads still work, actions are refused
      superseded: boolean
      response?: undefined
    }
  | {
      ok: false
      response: NextResponse
      // Set on a 410, so GET can show the company's branding and record
      // the expiry on the quote
      expiredQuote?: { id: string; companyId: string; status: QuoteStatus }
    }

// The start of every portal route. allowInternal lets the staff preview
// token through for reads; actions always refuse it.
export async function resolvePortalAccess(
  token: string,
  use: PortalUse,
  options: { allowInternal?: boolean; now?: Date } = {}
): Promise<PortalAccess> {
  const found = await findTokenQuote(token, use === "view" && !!options.allowInternal)
  if (!found) return { ok: false, response: linkInvalidResponse() }

  const { quote, kind } = found
  const superseded = kind === "client" && isSupersededVersion(quote, await findActiveSentVersionId(quote))
  const decision = decidePortalAccess(quote, kind, use, options.now ?? new Date(), superseded)
  if (!decision.ok) {
    if (decision.status === 404) return { ok: false, response: linkInvalidResponse() }
    return {
      ok: false,
      response: NextResponse.json({ error: decision.error, code: decision.code }, { status: decision.status }),
      ...(decision.status === 410 ? { expiredQuote: { id: quote.id, companyId: quote.companyId, status: quote.status } } : {}),
    }
  }
  return {
    ok: true,
    quoteId: quote.id,
    status: quote.status,
    isInternal: kind === "internal",
    expired: decision.expired,
    superseded,
  }
}

// The only quote related data an expired link returns: the company's
// public branding
export async function expiredBrandingResponse(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      logoUrl: true,
      secondaryLogoUrl: true,
      settings: { select: { primaryColor: true, accentColor: true } },
    },
  })
  return NextResponse.json(
    {
      error: QUOTE_EXPIRED_MESSAGE,
      code: "QUOTE_EXPIRED",
      company: {
        name: company?.name ?? "",
        logoUrl: company?.logoUrl ?? null,
        secondaryLogoUrl: company?.secondaryLogoUrl ?? null,
        primaryColor: company?.settings?.primaryColor ?? null,
        accentColor: company?.settings?.accentColor ?? null,
      },
    },
    { status: 410 }
  )
}
