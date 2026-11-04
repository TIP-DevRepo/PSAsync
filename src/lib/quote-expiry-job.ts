import type { Prisma, QuoteStatus } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isPastExpiry } from "@/lib/quote-expiry"
import { AWAITING_RESPONSE_STATUSES, isSupersededVersion } from "@/lib/portal-access"
import { applyTermsFreeze, isTermsFrozen, loadCompanyDefaultTerms, termsFreezeFor } from "@/lib/quote-terms"
import { prepareQuoteStatusChange, runQuoteStatusChange } from "@/lib/opportunity-quotes"
import { errorSummary } from "@/lib/user-error"

// The daily quote expiry job (GET /api/cron/expire-quotes, and the dev-only
// scripts/dev-only/run-quote-expiry.ts). A quote that was sent and never
// answered used to stay SENT or VIEWED past its Valid until date until the
// customer opened the link again, so its opportunity never moved. This
// stores EXPIRED for every such quote.
//
// Which quotes: status SENT or VIEWED (AWAITING_RESPONSE_STATUSES, the
// statuses the portal's own expiry write starts from) and past the Valid
// until date by the portal's rule (isPastExpiry: the end of that calendar
// day in PORTAL_EXPIRY_TIME_ZONE for a date only value, otherwise the stored
// time). Only the current version of each family: a superseded version (not
// the active one, while another version is active and was sent, the
// portal's isSupersededVersion) is left alone. Its customer can't act on it
// anyway, and expiring it would record a "quote expired" event on the
// opportunity, which can move it to Lost while the newer version is still
// open (the declined and expired rule only counts drafts in the quote's own
// family as open).
//
// How: each quote in its own transaction, through the path every staff
// status change takes (prepareQuoteStatusChange, the terms freeze, and
// runQuoteStatusChange), with the system as the actor (actorId null, shown
// as System on the timeline and in the audit log). The row is locked and
// read again first, so a quote another request answered or expired in the
// meantime is skipped and running twice expires nothing new. One quote
// failing is recorded and the rest carry on.

export const EXPIRE_QUOTES_DEFAULT_LIMIT = 200

// Candidates read per query while looking for eligible quotes
const PAGE_SIZE = 100

export interface ExpireOverdueQuotesOptions {
  now?: Date
  // Only these companies. Left out, every company; an empty list, none.
  companyIds?: readonly string[]
  // At most this many quotes are expired (or, on a dry run, listed) per run
  limit?: number
  // List what would expire without changing anything
  dryRun?: boolean
}

export interface ExpiryItem {
  quoteId: string
  companyId: string
  quoteNumber: string
  version: number
  expiresAt: Date
  opportunityId: string | null
}

export interface ExpireOverdueQuotesResult {
  dryRun: boolean
  // Quotes looked at: SENT or VIEWED with a Valid until date at or before now
  checked: number
  // Expired (or, on a dry run, that would be)
  expired: number
  // Looked at and left alone: not past the end of their Valid until day
  // yet, a superseded version, or answered or expired meanwhile
  skipped: number
  errors: { quoteId: string; error: string }[]
  // The limit was reached, so more may be waiting for the next run
  limitReached: boolean
  items: ExpiryItem[]
}

const candidateSelect = {
  id: true,
  companyId: true,
  quoteNumber: true,
  version: true,
  status: true,
  expiresAt: true,
  isActive: true,
  opportunityId: true,
} satisfies Prisma.QuoteSelect

type Candidate = Prisma.QuoteGetPayload<{ select: typeof candidateSelect }>

// A version that isn't the active one is superseded when another version
// of its family is active and was sent (the portal's rule). Only looked up
// for an inactive version.
async function isSuperseded(quote: Candidate): Promise<boolean> {
  if (quote.isActive) return false
  const active = await prisma.quote.findFirst({
    where: { companyId: quote.companyId, quoteNumber: quote.quoteNumber, isActive: true, sentAt: { not: null } },
    select: { id: true },
  })
  return isSupersededVersion(quote, active?.id ?? null)
}

// The quotes to expire, oldest Valid until date first, at most limit.
// expiresAt <= now is a cheap superset (a date only value runs until the
// end of its day); isPastExpiry decides.
async function findEligible(opts: { now: Date; companyIds?: readonly string[]; limit: number }) {
  const where: Prisma.QuoteWhereInput = {
    status: { in: [...AWAITING_RESPONSE_STATUSES] },
    expiresAt: { not: null, lte: opts.now },
    ...(opts.companyIds ? { companyId: { in: [...opts.companyIds] } } : {}),
  }
  const eligible: Candidate[] = []
  let checked = 0
  let skipped = 0
  let cursor: string | null = null
  let limitReached = false
  for (;;) {
    const page: Candidate[] = await prisma.quote.findMany({
      where,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: candidateSelect,
    })
    for (const quote of page) {
      if (eligible.length >= opts.limit) {
        limitReached = true
        break
      }
      checked++
      if (isPastExpiry(quote.expiresAt, opts.now) && !(await isSuperseded(quote))) eligible.push(quote)
      else skipped++
    }
    if (limitReached || page.length < PAGE_SIZE) break
    cursor = page[page.length - 1].id
  }
  return { eligible, checked, skipped, limitReached }
}

const toItem = (q: Candidate): ExpiryItem => ({
  quoteId: q.id,
  companyId: q.companyId,
  quoteNumber: q.quoteNumber,
  version: q.version,
  expiresAt: q.expiresAt!,
  opportunityId: q.opportunityId,
})

// One quote to EXPIRED, the way the status route moves it: planned first
// (expiring never creates an opportunity, so this plans nothing, but it is
// the same call), then one transaction that locks the row, checks it is
// still waiting on the customer and past its date, freezes the terms (a
// sent quote is already frozen, so nothing), stores the status, and runs the
// quote event as the system. False when it no longer qualifies.
async function expireOne(quote: Candidate, now: Date, defaultTerms: (companyId: string) => Promise<string | null>): Promise<boolean> {
  const to: QuoteStatus = "EXPIRED"
  const prepared = await prepareQuoteStatusChange(quote.companyId, quote, to)
  if (prepared.error !== undefined) throw new Error(prepared.error)

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Quote" WHERE "id" = ${quote.id} FOR UPDATE`
    const current = await tx.quote.findFirst({
      where: { id: quote.id, companyId: quote.companyId },
      select: { status: true, expiresAt: true, sentAt: true, useDefaultTerms: true },
    })
    if (!current || !AWAITING_RESPONSE_STATUSES.includes(current.status) || !isPastExpiry(current.expiresAt, now)) return false

    const freeze = isTermsFrozen(current) ? null : termsFreezeFor(current, await defaultTerms(quote.companyId))
    await applyTermsFreeze(tx, quote.id, freeze)
    await tx.quote.update({ where: { id: quote.id }, data: { status: to }, select: { id: true } })
    await runQuoteStatusChange(tx, { companyId: quote.companyId, quoteId: quote.id, from: current.status, to, actorId: null, plan: prepared.plan })
    return true
  })
}

export async function expireOverdueQuotes(options: ExpireOverdueQuotesOptions = {}): Promise<ExpireOverdueQuotesResult> {
  const now = options.now ?? new Date()
  const limit = Math.max(0, Math.floor(options.limit ?? EXPIRE_QUOTES_DEFAULT_LIMIT))
  const dryRun = !!options.dryRun
  const result: ExpireOverdueQuotesResult = { dryRun, checked: 0, expired: 0, skipped: 0, errors: [], limitReached: false, items: [] }
  if (limit === 0 || options.companyIds?.length === 0) return result

  const found = await findEligible({ now, companyIds: options.companyIds, limit })
  result.checked = found.checked
  result.skipped = found.skipped
  result.limitReached = found.limitReached

  if (dryRun) {
    result.items = found.eligible.map(toItem)
    result.expired = found.eligible.length
    return result
  }

  // Each company's default terms are read at most once per run
  const termsByCompany = new Map<string, Promise<string | null>>()
  const defaultTerms = (companyId: string) => {
    if (!termsByCompany.has(companyId)) termsByCompany.set(companyId, loadCompanyDefaultTerms(companyId))
    return termsByCompany.get(companyId)!
  }

  // One at a time, so a run never holds more than one connection
  for (const quote of found.eligible) {
    try {
      if (await expireOne(quote, now, defaultTerms)) {
        result.expired++
        result.items.push(toItem(quote))
      } else {
        result.skipped++
      }
    } catch (err) {
      result.errors.push({ quoteId: quote.id, error: errorSummary(err) })
    }
  }
  return result
}
