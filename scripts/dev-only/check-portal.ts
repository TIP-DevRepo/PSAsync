// DEV ONLY. Proves the customer portal rules against the locally running dev
// server: calls every portal route WITHOUT signing in, using the real tokens
// of the sample quotes create-test-companies.ts made, and checks every
// attempt in the ATTEMPTS list below. Test Admin B signs in only for the
// regenerate step and the staff response checks.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts), and only
// talks to a server on this machine. Run from the repo root, with the dev
// server running and the password set in the shell (never in a file):
//   TEST_ADMIN_B_PASSWORD=... npx tsx scripts/dev-only/check-portal.ts --yes
// Optional: --base-url http://localhost:3000 (the default)
//
// The quotes are put into each scene's state directly in the database
// (sent, viewed, expired, accepted and expired, never sent, moved back to
// draft), and every field this script touches is put back at the end, even
// when a check fails. Any FAIL or UNEXPECTED exits 1, a broken harness
// exits 2.
//
// No real email is ever sent: the test companies have no Microsoft
// credentials and no distributor turned on (findExternalServices, checked
// before anything runs). No attempt accepts, declines, or comments
// successfully, and the one client visit to a quote that is SENT is never
// made, so no notification fires. Nothing is uploaded anywhere.
//
// The terms scenes store terms holding a script tag, an img onerror, a
// javascript: link, and an onclick next to harmless text on Test Company
// B's sample quote, and check that the portal GET, the quote detail, and
// both PDF routes carry none of the dangerous parts but keep the text, and
// that a quote PATCH stores sanitized terms. The PDF body is compressed, so
// its text is checked on the HTML the route renders it from
// (buildQuotePdfHtml with the stored quote). The terms are put back too.
//
// The default terms scenes set Test Company B's default terms, store a
// draft with the "use default terms" box ticked over different custom
// text, and check that the internal preview, the staff and portal PDFs, and
// the quote detail show the default (the customer link does not open a
// draft yet). Test Admin B then marks it sent with POST quotes/[id]/send,
// which sends no email, the default is changed in the database, and the
// sent quote must still show the text frozen at the send on the customer
// link and in the PDF. The company default terms are put back at the end.
// The statusFreeze scene sets a never sent draft to DECLINED through the
// status route (the same freeze as ACCEPTED, without the sales order an
// acceptance creates) and checks the default was frozen into its terms.

import { Prisma, type PrismaClient } from "@/generated/prisma"
import { enforceDevGuard, findExternalServices } from "./lib/guard"
import { loadPermissionFixtureIds, loadSampleIds, testNames, type SampleIds } from "./lib/test-data"
import { HarnessBroken, Session, errorText, isJsonError, printTable, readBaseUrl, type Method, type Row } from "./lib/harness"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("check-portal")

// ─── SCENES ─────────────────────────────────────────────────────────────────
// The state the sample quotes are put in before a scene's attempts run.
//   bQuote    Test Company B's sample quote
//   repQuote  Test Company B's rep quote, used as a quote that was never sent
//   cQuote    Test Company C's sample quote
type Scene =
  | "awaiting" // B and C VIEWED, sent, expiring next week; rep quote never sent
  | "sentUnviewed" // B SENT, never viewed (only the internal token opens it)
  | "expired" // B VIEWED, expired yesterday
  | "acceptedExpired" // B ACCEPTED, expired yesterday
  | "accepted" // B ACCEPTED, not expired
  | "declined" // B DECLINED, not expired
  | "backToDraft" // B sent, then moved back to DRAFT
  | "terms" // B VIEWED, not expired, with HOSTILE_TERMS stored as its terms
  | "termsPatch" // B DRAFT, never sent, box unticked, no terms, for the PATCH step
  | "defaultDraft" // B DRAFT, never sent, box ticked over CUSTOM_OLD, company default DEFAULT_ONE
  | "defaultFrozen" // B VIEWED after the send froze DEFAULT_ONE, company default changed to DEFAULT_TWO
  | "statusFreeze" // B DRAFT, never sent, box ticked over CUSTOM_OLD, company default DEFAULT_ONE
  | "regenerate" // B VIEWED, not expired, for the regenerate steps

// ─── ATTEMPTS ───────────────────────────────────────────────────────────────
// Every portal attempt, in one list, run scene by scene in this order.
//
//   as           anonymous (no session, the default) or admin (Test Admin B)
//   kind         control: must succeed, and if it doesn't the harness is
//                broken and nothing else runs. allowed: must succeed.
//                refused: must be refused with exactly expect and must not
//                change any data.
//   expect       the status
//   expectError  text a refusal must contain
//   code         the refusal's code
//   contains / notContains   text the response must or must not include
//   check        extra checks, returning a problem or null
//   after        runs after the attempt, for the regenerate steps

type Actor = "anonymous" | "admin"

interface Ctx {
  b: SampleIds
  c: SampleIds
  bClient: string
  bInternal: string
  cClient: string
  repClient: string
  unknown: string
  // Set by the regenerate step
  oldBClient: string
  newBClient: string
  adminEmailB: string
  texts: Record<string, string>
}

interface Attempt {
  scene: Scene
  name: string
  as?: Actor
  kind: "control" | "allowed" | "refused"
  method: Method
  path: (ctx: Ctx) => string
  body?: (ctx: Ctx) => unknown
  expect: number
  expectError?: string
  code?: string
  contains?: (ctx: Ctx) => string[]
  notContains?: (ctx: Ctx) => string[]
  check?: (res: { status: number; text: string }, ctx: Ctx, prisma: PrismaClient) => Promise<string | null>
  after?: (res: { status: number; text: string }, ctx: Ctx) => void
}

const B = testNames("B")
const C = testNames("C")

// What a public response must never carry. Keys are checked with their
// quotes so words in the quote's own text can't match.
const PRIVATE_KEYS = ['"cost"', '"internalNotes"', '"pendingEmailPayload"', '"accessToken"', '"internalAccessToken"', '"companyId"', '"userId"']
const privateValues = (ctx: Ctx) => [...PRIVATE_KEYS, ctx.bClient, ctx.bInternal, ctx.adminEmailB]
const companyC = [C.company, C.client, C.quoteLine]
const companyB = [B.company, B.client, B.quoteLine]
const p = (token: (ctx: Ctx) => string, rest = "") => (ctx: Ctx) => `/api/portal/${token(ctx)}${rest}`
const bClient = (ctx: Ctx) => ctx.bClient
const LINK_INVALID = "This link is no longer valid"
const SIGNED = { signatureType: "TYPED", signatureData: "Dev Only", signerName: "Dev Only", termsAgreed: true }

// Terms with every dangerous part next to text that must survive
const HOSTILE_TERMS =
  `<p>Harmless terms text</p><script>alert("xss-script")</script>` +
  `<img src="x" onerror="alert('xss-img')">` +
  `<a href="javascript:alert('xss-link')">Harmless link text</a>` +
  `<p onclick="alert('xss-click')">Harmless click text</p>`
const TERMS_SAFE = ["Harmless terms text", "Harmless link text", "Harmless click text"]
const TERMS_DANGER = ["<script", "xss-script", "onerror", "xss-img", "javascript:", "xss-link", "onclick", "xss-click"]

function termsProblem(text: string, what: string): string | null {
  const missing = TERMS_SAFE.filter((t) => !text.includes(t))
  if (missing.length > 0) return `${what} is missing ${missing.join(", ")}`
  const present = TERMS_DANGER.filter((t) => text.includes(t))
  return present.length > 0 ? `${what} still contains ${present.join(", ")}` : null
}

// Company default terms and custom text for the default terms scenes
const DEFAULT_ONE = "<p>Dev only company default terms one</p>"
const DEFAULT_TWO = "<p>Dev only company default terms two</p>"
const CUSTOM_OLD = "<p>Dev only old custom terms</p>"
const DEFAULT_ONE_TEXT = "Dev only company default terms one"
const DEFAULT_TWO_TEXT = "Dev only company default terms two"
const CUSTOM_OLD_TEXT = "Dev only old custom terms"

function textsProblem(text: string, what: string, must: string[], mustNot: string[]): string | null {
  const missing = must.filter((t) => !text.includes(t))
  if (missing.length > 0) return `${what} is missing ${missing.join(", ")}`
  const present = mustNot.filter((t) => text.includes(t))
  return present.length > 0 ? `${what} still contains ${present.join(", ")}` : null
}

// The quote detail's effective terms
function effectiveTermsProblem(res: { text: string }, must: string[], mustNot: string[]): string | null {
  const body = JSON.parse(res.text) as { effectiveTerms?: string | null }
  return textsProblem(body.effectiveTerms ?? "", "effectiveTerms", must, mustNot)
}

// The HTML the quote PDF routes render, built the same way from the stored
// quote and the company default
async function pdfHtml(prisma: PrismaClient, quoteId: string): Promise<string> {
  const { buildQuotePdfHtml } = await import("@/lib/quote-pdf-template")
  const { loadCompanyDefaultTerms, resolveQuoteTerms } = await import("@/lib/quote-terms")
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: {
      client: { select: { name: true } },
      contact: { select: { firstName: true, lastName: true } },
      user: { select: { name: true, email: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  })
  const effectiveTerms = resolveQuoteTerms(quote, await loadCompanyDefaultTerms(quote.companyId))
  return buildQuotePdfHtml({ ...quote, effectiveTerms }, { name: B.company, logoUrl: null, primaryColor: "#1B3A5C", accentColor: "#2E86AB" })
}

async function pdfHtmlTermsProblem(prisma: PrismaClient, quoteId: string): Promise<string | null> {
  return termsProblem(await pdfHtml(prisma, quoteId), "the PDF HTML")
}

const ATTEMPTS: Attempt[] = [
  // ── A valid link ──
  { scene: "awaiting", name: "client GET returns the public quote", kind: "control", method: "GET", path: p(bClient), expect: 200,
    contains: () => [B.quote, B.company, B.quoteLine], notContains: (ctx) => [...privateValues(ctx), ...companyC] },
  { scene: "awaiting", name: "client comments GET", kind: "allowed", method: "GET", path: p(bClient, "/comments"), expect: 200,
    notContains: () => ['"authorUserId"'] },
  { scene: "awaiting", name: "accept without a signature passes the status gate", kind: "refused", method: "POST", path: p(bClient, "/accept"),
    body: () => ({}), expect: 400, expectError: "A signature is required" },
  { scene: "awaiting", name: "line item update with nothing passes the status gate", kind: "refused", method: "PATCH",
    path: (ctx) => `/api/portal/${ctx.bClient}/line-items/${ctx.b.quoteLineId}`, body: () => ({}), expect: 400, expectError: "Nothing to update" },
  { scene: "awaiting", name: "Company C link shows only Company C", kind: "allowed", method: "GET", path: (ctx) => `/api/portal/${ctx.cClient}`,
    expect: 200, contains: () => [C.company], notContains: () => companyB },
  { scene: "awaiting", name: "Company B token cannot change a Company C line item", kind: "refused", method: "PATCH",
    path: (ctx) => `/api/portal/${ctx.bClient}/line-items/${ctx.c.quoteLineId}`, body: () => ({ quantity: 5 }), expect: 404, expectError: "Line item not found" },
  { scene: "awaiting", name: "never sent quote is not valid", kind: "refused", method: "GET", path: (ctx) => `/api/portal/${ctx.repClient}`,
    expect: 404, expectError: LINK_INVALID, code: "LINK_INVALID", after: (res, ctx) => (ctx.texts.neverSent = res.text) },
  { scene: "awaiting", name: "unknown token is not valid", kind: "refused", method: "GET", path: (ctx) => `/api/portal/${ctx.unknown}`,
    expect: 404, expectError: LINK_INVALID, code: "LINK_INVALID",
    check: async (res, ctx) => (res.text === ctx.texts.neverSent ? null : "a never sent quote and an unknown token answer differently") },
  { scene: "awaiting", name: "never sent quote cannot be accepted", kind: "refused", method: "POST", path: (ctx) => `/api/portal/${ctx.repClient}/accept`,
    body: () => SIGNED, expect: 404, expectError: LINK_INVALID },
  { scene: "awaiting", name: "internal token cannot accept", kind: "refused", method: "POST", path: (ctx) => `/api/portal/${ctx.bInternal}/accept`,
    body: () => SIGNED, expect: 404, expectError: LINK_INVALID },
  { scene: "awaiting", name: "internal token cannot comment", kind: "refused", method: "POST", path: (ctx) => `/api/portal/${ctx.bInternal}/comments`,
    body: () => ({ message: "dev only" }), expect: 404, expectError: LINK_INVALID },

  // ── The internal preview never changes the quote ──
  { scene: "sentUnviewed", name: "internal GET is a preview", kind: "allowed", method: "GET", path: (ctx) => `/api/portal/${ctx.bInternal}`,
    expect: 200, contains: () => ['"isInternalPreview":true'], notContains: privateValues,
    check: async (_res, ctx, prisma) => {
      const q = await prisma.quote.findUnique({ where: { id: ctx.b.quoteId }, select: { status: true, viewedAt: true } })
      return q?.status === "SENT" && !q.viewedAt ? null : `the internal view changed the quote to ${q?.status}`
    } },

  // ── Expired ──
  { scene: "expired", name: "comments GET is expired", kind: "refused", method: "GET", path: p(bClient, "/comments"), expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "expired", name: "comment POST is expired", kind: "refused", method: "POST", path: p(bClient, "/comments"), body: () => ({ message: "dev only" }), expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "expired", name: "accept is expired", kind: "refused", method: "POST", path: p(bClient, "/accept"), body: () => SIGNED, expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "expired", name: "decline is expired", kind: "refused", method: "POST", path: p(bClient, "/decline"), body: () => ({ reason: "dev only" }), expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "expired", name: "line item update is expired", kind: "refused", method: "PATCH",
    path: (ctx) => `/api/portal/${ctx.bClient}/line-items/${ctx.b.quoteLineId}`, body: () => ({ quantity: 2 }), expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "expired", name: "PDF is expired", kind: "refused", method: "GET", path: p(bClient, "/pdf"), expect: 410, code: "QUOTE_EXPIRED" },
  // Runs last in the scene: it also records the quote as EXPIRED
  { scene: "expired", name: "GET shows only the branding", kind: "refused", method: "GET", path: p(bClient), expect: 410, code: "QUOTE_EXPIRED",
    contains: () => [B.company], notContains: (ctx) => [...privateValues(ctx), B.quote, B.quoteLine, '"quoteNumber"', '"lineItems"'],
    check: async (res) => {
      const body = JSON.parse(res.text) as Record<string, unknown>
      const keys = Object.keys(body).sort().join(",")
      return keys === "code,company,error" ? null : `410 body has extra fields: ${keys}`
    } },

  // ── Accepted and expired: view only ──
  { scene: "acceptedExpired", name: "GET still shows the accepted quote", kind: "allowed", method: "GET", path: p(bClient), expect: 200,
    contains: () => ['"status":"ACCEPTED"', B.quoteLine], notContains: privateValues },
  { scene: "acceptedExpired", name: "PDF still downloads", kind: "allowed", method: "GET", path: p(bClient, "/pdf"), expect: 200,
    contains: () => ["%PDF"] },
  { scene: "acceptedExpired", name: "accept is refused", kind: "refused", method: "POST", path: p(bClient, "/accept"), body: () => SIGNED, expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "acceptedExpired", name: "decline is refused", kind: "refused", method: "POST", path: p(bClient, "/decline"), body: () => ({}), expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "acceptedExpired", name: "comment is refused", kind: "refused", method: "POST", path: p(bClient, "/comments"), body: () => ({ message: "dev only" }), expect: 410, code: "QUOTE_EXPIRED" },
  { scene: "acceptedExpired", name: "line item update is refused", kind: "refused", method: "PATCH",
    path: (ctx) => `/api/portal/${ctx.bClient}/line-items/${ctx.b.quoteLineId}`, body: () => ({ quantity: 2 }), expect: 410, code: "QUOTE_EXPIRED" },

  // ── Not awaiting a response ──
  { scene: "accepted", name: "accept on an accepted quote", kind: "refused", method: "POST", path: p(bClient, "/accept"), body: () => SIGNED,
    expect: 400, expectError: "already been responded to" },
  { scene: "accepted", name: "decline on an accepted quote", kind: "refused", method: "POST", path: p(bClient, "/decline"), body: () => ({}),
    expect: 400, expectError: "already been responded to" },
  { scene: "declined", name: "accept on a declined quote", kind: "refused", method: "POST", path: p(bClient, "/accept"), body: () => SIGNED,
    expect: 400, expectError: "already been responded to" },
  { scene: "declined", name: "comment on a declined quote", kind: "refused", method: "POST", path: p(bClient, "/comments"), body: () => ({ message: "dev only" }),
    expect: 400, expectError: "already been responded to" },
  { scene: "backToDraft", name: "GET on a quote moved back to draft", kind: "refused", method: "GET", path: p(bClient), expect: 404, expectError: LINK_INVALID },
  { scene: "backToDraft", name: "accept on a quote moved back to draft", kind: "refused", method: "POST", path: p(bClient, "/accept"), body: () => SIGNED,
    expect: 404, expectError: LINK_INVALID },

  // ── Terms are sanitized on the way out, whatever is stored ──
  { scene: "terms", name: "portal GET drops unsafe terms markup", kind: "allowed", method: "GET", path: p(bClient), expect: 200,
    contains: () => TERMS_SAFE, notContains: () => TERMS_DANGER },
  { scene: "terms", name: "portal PDF renders with unsafe terms stored", kind: "allowed", method: "GET", path: p(bClient, "/pdf"), expect: 200,
    contains: () => ["%PDF"], notContains: () => ["javascript:"] },
  { scene: "terms", as: "admin", name: "quote detail drops unsafe terms markup", kind: "allowed", method: "GET",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}`, expect: 200, contains: () => TERMS_SAFE, notContains: () => TERMS_DANGER },
  { scene: "terms", as: "admin", name: "quote PDF drops unsafe terms markup", kind: "allowed", method: "GET",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}/pdf`, expect: 200, contains: () => ["%PDF"], notContains: () => ["javascript:"],
    check: async (_res, ctx, prisma) => pdfHtmlTermsProblem(prisma, ctx.b.quoteId) },

  // ── Terms are sanitized on save ──
  { scene: "termsPatch", as: "admin", name: "quote PATCH stores sanitized terms", kind: "allowed", method: "PATCH",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}`, body: () => ({ terms: HOSTILE_TERMS }), expect: 200,
    contains: () => TERMS_SAFE, notContains: () => TERMS_DANGER,
    check: async (_res, ctx, prisma) => {
      const q = await prisma.quote.findUnique({ where: { id: ctx.b.quoteId }, select: { terms: true } })
      return termsProblem(q?.terms ?? "", "the stored terms")
    } },

  // ── A draft using the company default shows the current default everywhere ──
  { scene: "defaultDraft", name: "internal preview shows the default, not old custom text", kind: "allowed", method: "GET",
    path: (ctx) => `/api/portal/${ctx.bInternal}`, expect: 200, contains: () => [DEFAULT_ONE_TEXT, '"isInternalPreview":true'],
    notContains: () => [CUSTOM_OLD_TEXT, '"useDefaultTerms"', '"quoteTerms"'] },
  { scene: "defaultDraft", name: "customer link does not open the unsent draft", kind: "refused", method: "GET", path: p(bClient),
    expect: 404, expectError: LINK_INVALID },
  { scene: "defaultDraft", name: "internal preview PDF uses the default", kind: "allowed", method: "GET",
    path: (ctx) => `/api/portal/${ctx.bInternal}/pdf`, expect: 200, contains: () => ["%PDF"],
    check: async (_res, ctx, prisma) => textsProblem(await pdfHtml(prisma, ctx.b.quoteId), "the PDF HTML", [DEFAULT_ONE_TEXT], [CUSTOM_OLD_TEXT]) },
  { scene: "defaultDraft", as: "admin", name: "staff PDF renders for the draft", kind: "allowed", method: "GET",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}/pdf`, expect: 200, contains: () => ["%PDF"] },
  { scene: "defaultDraft", as: "admin", name: "quote detail effective terms are the default", kind: "allowed", method: "GET",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}`, expect: 200, contains: () => ['"termsDifferFromDefault":true'],
    check: async (res) => effectiveTermsProblem(res, [DEFAULT_ONE_TEXT], [CUSTOM_OLD_TEXT]) },
  // POST send marks it sent without any email (no approval workflow is
  // active for the test companies, so it is not held)
  { scene: "defaultDraft", as: "admin", name: "mark as sent freezes the default", kind: "allowed", method: "POST",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}/send`, expect: 200,
    check: async (_res, ctx, prisma) => {
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: ctx.b.quoteId }, select: { status: true, sentAt: true, terms: true } })
      if (q.status !== "SENT" || !q.sentAt) return `the quote is ${q.status}, not sent (is an approval workflow active?)`
      return textsProblem(q.terms ?? "", "the stored terms", [DEFAULT_ONE_TEXT], [CUSTOM_OLD_TEXT])
    } },

  // ── After the send, a change to the company default changes nothing ──
  { scene: "defaultFrozen", name: "customer link keeps the frozen terms", kind: "allowed", method: "GET", path: p(bClient), expect: 200,
    contains: () => [DEFAULT_ONE_TEXT], notContains: () => [DEFAULT_TWO_TEXT, CUSTOM_OLD_TEXT] },
  { scene: "defaultFrozen", name: "customer PDF keeps the frozen terms", kind: "allowed", method: "GET", path: p(bClient, "/pdf"), expect: 200,
    contains: () => ["%PDF"],
    check: async (_res, ctx, prisma) => textsProblem(await pdfHtml(prisma, ctx.b.quoteId), "the PDF HTML", [DEFAULT_ONE_TEXT], [DEFAULT_TWO_TEXT]) },
  { scene: "defaultFrozen", as: "admin", name: "quote detail keeps the frozen terms", kind: "allowed", method: "GET",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}`, expect: 200,
    check: async (res) => effectiveTermsProblem(res, [DEFAULT_ONE_TEXT], [DEFAULT_TWO_TEXT]) },

  // ── Moving a never sent quote past draft by hand freezes its terms ──
  { scene: "statusFreeze", as: "admin", name: "status change to DECLINED freezes the default", kind: "allowed", method: "POST",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}/status`, body: () => ({ status: "DECLINED" }), expect: 200,
    check: async (_res, ctx, prisma) => {
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: ctx.b.quoteId }, select: { status: true, sentAt: true, terms: true } })
      if (q.status !== "DECLINED" || q.sentAt) return `the quote is ${q.status}${q.sentAt ? " and was marked sent" : ""}`
      return textsProblem(q.terms ?? "", "the stored terms", [DEFAULT_ONE_TEXT], [CUSTOM_OLD_TEXT])
    } },

  // ── Staff responses and regenerate ──
  { scene: "regenerate", as: "admin", name: "quote detail has no customer token", kind: "control", method: "GET", path: (ctx) => `/api/quotes/${ctx.b.quoteId}`,
    expect: 200, contains: () => ['"internalAccessToken"'], notContains: (ctx) => ['"accessToken"', ctx.bClient] },
  { scene: "regenerate", as: "admin", name: "quotes list has no customer token", kind: "allowed", method: "GET", path: () => "/api/quotes",
    expect: 200, notContains: (ctx) => ['"accessToken"', ctx.bClient] },
  { scene: "regenerate", as: "admin", name: "portal-link returns the customer link", kind: "allowed", method: "GET",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}/portal-link`, expect: 200, contains: (ctx) => [ctx.bClient, '"opens":true'] },
  { scene: "regenerate", as: "admin", name: "regenerate the customer link", kind: "allowed", method: "POST",
    path: (ctx) => `/api/quotes/${ctx.b.quoteId}/portal-link/regenerate`, expect: 200, notContains: (ctx) => [ctx.bClient],
    check: async (res, ctx, prisma) => {
      const q = await prisma.quote.findUnique({ where: { id: ctx.b.quoteId }, select: { internalNotes: true } })
      return q?.internalNotes?.startsWith("[Customer link regenerated by ") ? null : "no regenerate note on the quote"
    },
    after: (res, ctx) => {
      const url = (JSON.parse(res.text) as { url?: string }).url ?? ""
      ctx.oldBClient = ctx.bClient
      ctx.newBClient = url.split("/portal/")[1] ?? ""
    } },
  { scene: "regenerate", name: "old link no longer works", kind: "refused", method: "GET", path: (ctx) => `/api/portal/${ctx.oldBClient}`,
    expect: 404, expectError: LINK_INVALID },
  { scene: "regenerate", name: "old link cannot accept", kind: "refused", method: "POST", path: (ctx) => `/api/portal/${ctx.oldBClient}/accept`,
    body: () => SIGNED, expect: 404, expectError: LINK_INVALID },
  { scene: "regenerate", name: "new link works", kind: "allowed", method: "GET", path: (ctx) => `/api/portal/${ctx.newBClient}`,
    expect: 200, contains: () => [B.quote], notContains: (ctx) => [...PRIVATE_KEYS, ctx.newBClient, ctx.adminEmailB, ...companyC] },
]

const SCENE_ORDER: Scene[] = [
  "awaiting",
  "sentUnviewed",
  "expired",
  "acceptedExpired",
  "accepted",
  "declined",
  "backToDraft",
  "terms",
  "termsPatch",
  "defaultDraft",
  "defaultFrozen",
  "statusFreeze",
  "regenerate",
]

// ─── Database state ─────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000

const quoteFields = {
  id: true,
  status: true,
  sentAt: true,
  viewedAt: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  declineReason: true,
  isActive: true,
  accessToken: true,
  internalNotes: true,
  terms: true,
  useDefaultTerms: true,
} as const

async function setScene(prisma: PrismaClient, scene: Scene, ids: { b: string; rep: string; c: string; companyB: string }) {
  const now = Date.now()
  const sent = new Date(now - 2 * DAY)
  const nextWeek = new Date(now + 7 * DAY)
  const yesterday = new Date(now - DAY)
  const base = { sentAt: sent, viewedAt: sent, expiresAt: nextWeek, acceptedAt: null, declinedAt: null, declineReason: null }
  const b = {
    awaiting: { ...base, status: "VIEWED" as const },
    sentUnviewed: { ...base, status: "SENT" as const, viewedAt: null },
    expired: { ...base, status: "VIEWED" as const, expiresAt: yesterday },
    acceptedExpired: { ...base, status: "ACCEPTED" as const, acceptedAt: sent, expiresAt: yesterday },
    accepted: { ...base, status: "ACCEPTED" as const, acceptedAt: sent },
    declined: { ...base, status: "DECLINED" as const, declinedAt: sent },
    backToDraft: { ...base, status: "DRAFT" as const },
    terms: { ...base, status: "VIEWED" as const },
    termsPatch: { ...base, status: "DRAFT" as const, sentAt: null, viewedAt: null },
    defaultDraft: { ...base, status: "DRAFT" as const, sentAt: null, viewedAt: null },
    // Keeps the terms the send froze
    defaultFrozen: { ...base, status: "VIEWED" as const },
    statusFreeze: { ...base, status: "DRAFT" as const, sentAt: null, viewedAt: null },
    regenerate: { ...base, status: "VIEWED" as const },
  }[scene]
  // Written straight to the database, past the sanitizer, the way terms
  // saved before it would look
  const terms =
    scene === "terms"
      ? { terms: HOSTILE_TERMS }
      : scene === "termsPatch"
        ? { terms: null, useDefaultTerms: false }
        : scene === "defaultDraft" || scene === "statusFreeze"
          ? { terms: CUSTOM_OLD, useDefaultTerms: true }
          : {}
  await prisma.quote.update({ where: { id: ids.b }, data: { ...b, ...terms } })
  // Company B's default terms, put back at the end
  const companyDefault =
    scene === "defaultDraft" || scene === "statusFreeze" ? DEFAULT_ONE : scene === "defaultFrozen" ? DEFAULT_TWO : null
  if (companyDefault) {
    await prisma.companySettings.upsert({
      where: { companyId: ids.companyB },
      update: { quoteTerms: companyDefault },
      create: { companyId: ids.companyB, quoteTerms: companyDefault },
    })
  }
  await prisma.quote.update({ where: { id: ids.rep }, data: { status: "DRAFT", sentAt: null, viewedAt: null } })
  await prisma.quote.update({ where: { id: ids.c }, data: { ...base, status: "VIEWED" } })
}

// What a refused attempt must leave alone
async function snapshot(prisma: PrismaClient, quoteIds: string[], companyIds: string[]) {
  const [quotes, lines, comments, notifications, salesOrders] = await Promise.all([
    prisma.quote.findMany({ where: { id: { in: quoteIds } }, select: quoteFields, orderBy: { id: "asc" } }),
    prisma.quoteLineItem.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true, quantity: true, optionalSelected: true }, orderBy: { id: "asc" } }),
    prisma.quoteComment.count({ where: { quoteId: { in: quoteIds } } }),
    prisma.notification.count({ where: { companyId: { in: companyIds } } }),
    prisma.salesOrder.count({ where: { quoteId: { in: quoteIds } } }),
  ])
  return { quotes: JSON.stringify(quotes), lines: JSON.stringify(lines), comments, notifications, salesOrders }
}

function changedSections(before: Awaited<ReturnType<typeof snapshot>>, after: typeof before): string[] {
  return (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== after[k])
}

// ─── Judging ────────────────────────────────────────────────────────────────

function expectedText(a: Attempt) {
  return `${a.expect}${a.code ? ` ${a.code}` : ""}${a.expectError ? ` "${a.expectError}"` : ""}`
}

function contentProblem(a: Attempt, res: { text: string }, ctx: Ctx): string | null {
  const missing = (a.contains?.(ctx) ?? []).filter((t) => !res.text.includes(t))
  if (missing.length > 0) return `response is missing ${missing.slice(0, 3).join(", ")}`
  const present = (a.notContains?.(ctx) ?? []).filter((t) => t && res.text.includes(t))
  if (present.length > 0) return `response must not contain ${present.slice(0, 3).map((t) => (t.length > 30 ? "a token or email" : t)).join(", ")}`
  return null
}

async function judge(a: Attempt, res: { status: number; text: string }, ctx: Ctx, prisma: PrismaClient, changed: string[]): Promise<Pick<Row, "result" | "note">> {
  if (a.kind !== "refused") {
    if (res.status !== a.expect) return { result: "FAIL", note: `got ${res.status}: ${errorText(res.text)}` }
    const problem = contentProblem(a, res, ctx) ?? (a.check ? await a.check(res, ctx, prisma) : null)
    return problem ? { result: "FAIL", note: problem } : { result: "PASS" }
  }

  const message = errorText(res.text)
  if (changed.length > 0) return { result: "FAIL", note: `data changed: ${changed.join(", ")}` }
  if (res.status >= 200 && res.status < 300) return { result: "FAIL", note: `request succeeded: ${message}` }
  if (res.status >= 500) return { result: "FAIL", note: `server error: ${message}` }
  if (res.status !== a.expect) return { result: res.status === 404 && a.expect !== 404 ? "FAIL" : "UNEXPECTED", note: `refused with ${res.status}: ${message}` }
  if (!isJsonError(res.text)) return { result: "UNEXPECTED", note: "not a JSON refusal from the app, the route path may be wrong" }
  if (a.expectError && !message.includes(a.expectError)) return { result: "UNEXPECTED", note: `refused for a different reason: ${message}` }
  if (a.code && !res.text.includes(`"code":"${a.code}"`)) return { result: "UNEXPECTED", note: `refused without code ${a.code}` }
  const problem = contentProblem(a, res, ctx) ?? (a.check ? await a.check(res, ctx, prisma) : null)
  return problem ? { result: "FAIL", note: problem } : { result: "PASS" }
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  const adminPassword = process.env.TEST_ADMIN_B_PASSWORD
  if (!adminPassword) {
    throw new HarnessBroken("Set TEST_ADMIN_B_PASSWORD in your shell (the password create-test-companies printed).")
  }

  // Imported only after the guard passed
  const { prisma } = await import("@/lib/prisma")
  const { newAccessToken } = await import("@/lib/portal-token")
  const rows: Row[] = []
  const startedAt = new Date()

  const b = await loadSampleIds(prisma, "B")
  const c = await loadSampleIds(prisma, "C")
  const fx = await loadPermissionFixtureIds(prisma, "B")

  // Safety: with no Microsoft credentials and no distributor turned on, no
  // email can be sent and no distributor reached even if a check misbehaves
  const external = await findExternalServices(prisma, [b.companyId, c.companyId])
  if (external) throw new HarnessBroken(external)
  if (!b.quoteId || !c.quoteId || !fx.repQuoteId || !b.quoteLineId || !c.quoteLineId) {
    throw new HarnessBroken("The sample quotes are missing. Run create-test-companies first.")
  }

  // Every version of the three quotes, so all of them are put back
  const families = await prisma.quote.findMany({
    where: { id: { in: [b.quoteId, c.quoteId, fx.repQuoteId] } },
    select: { companyId: true, quoteNumber: true },
  })
  const familyRows = await prisma.quote.findMany({
    where: { OR: families.map((f) => ({ companyId: f.companyId, quoteNumber: f.quoteNumber })) },
    select: quoteFields,
  })
  const familyIds = familyRows.map((q) => q.id)
  const original = await prisma.quote.findMany({
    where: { id: { in: familyIds } },
    select: { ...quoteFields, pendingEmailPayload: true, lineItems: { select: { id: true, quantity: true, optionalSelected: true } } },
  })
  // Company B's default terms, changed by the default terms scenes
  const originalSettings = await prisma.companySettings.findUnique({ where: { companyId: b.companyId }, select: { quoteTerms: true } })
  if (familyRows.length !== 3) {
    throw new HarnessBroken("The sample quotes have extra versions. Run create-test-companies again to reset them.")
  }

  const bRow = await prisma.quote.findUniqueOrThrow({ where: { id: b.quoteId }, select: { accessToken: true, internalAccessToken: true } })
  const cRow = await prisma.quote.findUniqueOrThrow({ where: { id: c.quoteId }, select: { accessToken: true } })
  const repRow = await prisma.quote.findUniqueOrThrow({ where: { id: fx.repQuoteId }, select: { accessToken: true } })
  const ctx: Ctx = {
    b,
    c,
    bClient: bRow.accessToken,
    bInternal: bRow.internalAccessToken,
    cClient: cRow.accessToken,
    repClient: repRow.accessToken,
    unknown: newAccessToken(),
    oldBClient: "",
    newBClient: "",
    adminEmailB: B.adminEmail,
    texts: {},
  }

  try {
    const anonymous = new Session("Anonymous", baseUrl)
    const admin = new Session("Test Admin B", baseUrl)
    await admin.signIn(B.adminEmail, adminPassword)
    console.log(`Calling the portal on ${baseUrl} without signing in. Test Admin B is signed in for the staff checks only.`)

    for (const scene of SCENE_ORDER) {
      await setScene(prisma, scene, { b: b.quoteId, rep: fx.repQuoteId, c: c.quoteId, companyB: b.companyId })
      let before = await snapshot(prisma, familyIds, [b.companyId, c.companyId])
      for (const a of ATTEMPTS.filter((x) => x.scene === scene)) {
        const label = `[${scene}${a.as === "admin" ? ", Admin B" : ""}] ${a.name}`
        let res: { status: number; text: string }
        try {
          res = await (a.as === "admin" ? admin : anonymous).request(a.method, a.path(ctx), { json: a.body?.(ctx) })
        } catch (err) {
          rows.push({ attempt: label, expected: expectedText(a), actual: "no response", result: "UNEXPECTED", note: err instanceof Error ? err.message : String(err) })
          continue
        }
        // A refused attempt must change nothing. The expired GET may record
        // the expiry on the quote, which is what it is for.
        let changed: string[] = []
        if (a.kind === "refused" && !(scene === "expired" && a.method === "GET")) {
          changed = changedSections(before, await snapshot(prisma, familyIds, [b.companyId, c.companyId]))
        }
        const verdict = await judge(a, res, ctx, prisma, changed)
        rows.push({ attempt: label, expected: expectedText(a), actual: String(res.status), ...verdict })
        a.after?.(res, ctx)
        if (a.kind === "control" && verdict.result !== "PASS") {
          printTable(rows)
          throw new HarnessBroken(`Positive control "${label}" failed, so the harness itself is broken. No other attempts were run.`)
        }
        before = await snapshot(prisma, familyIds, [b.companyId, c.companyId])
      }
    }

    printTable(rows)
    const count = (r: Row["result"]) => rows.filter((row) => row.result === r).length
    console.log(`\n${rows.length} checks: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("UNEXPECTED")} UNEXPECTED`)
    return count("FAIL") + count("UNEXPECTED") > 0 ? 1 : 0
  } finally {
    // Put every version back exactly as it was, tokens, notes, and terms included
    for (const q of original) {
      const { id, lineItems, pendingEmailPayload, ...fields } = q
      await prisma.quote.update({
        where: { id },
        data: { ...fields, pendingEmailPayload: pendingEmailPayload === null ? Prisma.DbNull : (pendingEmailPayload as Prisma.InputJsonValue) },
      })
      for (const li of lineItems) {
        await prisma.quoteLineItem.update({ where: { id: li.id }, data: { quantity: li.quantity, optionalSelected: li.optionalSelected } })
      }
    }
    // Nothing above should create these; if a broken rule did, remove them
    await prisma.quoteComment.deleteMany({ where: { quoteId: { in: familyIds }, createdAt: { gte: startedAt } } })
    await prisma.notification.deleteMany({
      where: { companyId: { in: [b.companyId, c.companyId] }, createdAt: { gte: startedAt }, link: { in: familyIds.map((id) => `/dashboard/quotes/${id}`) } },
    })
    // Company B's default terms as they were, or no settings row if it had none
    if (originalSettings) {
      await prisma.companySettings.update({ where: { companyId: b.companyId }, data: { quoteTerms: originalSettings.quoteTerms } })
    } else {
      await prisma.companySettings.deleteMany({ where: { companyId: b.companyId } })
    }
    console.log("Sample quotes and Company B's default terms put back the way they were.")
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(err instanceof HarnessBroken ? 2 : 1)
  })
