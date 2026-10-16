// DEV ONLY. Proves the permission checks inside one company against the
// locally running dev server: signs in as Test Admin B (Global Admin), Test
// Rep B (only the Rep role), and Test Everyone B (only the Everyone role,
// with no permissions), all made by create-test-companies.ts, plus a Test
// Sender B user this script sets up itself, and checks every attempt in the
// ATTEMPTS list below.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts), and only
// talks to a server on this machine. Run from the repo root, with the dev
// server running and the passwords set in the shell (never in a file):
//   TEST_ADMIN_B_PASSWORD=... TEST_REP_B_PASSWORD=... TEST_EVERYONE_B_PASSWORD=... npx tsx scripts/dev-only/check-permissions.ts --yes
// Optional: --base-url http://localhost:3000 (the default)
//
// Order of work: guard, safety checks, sign in, every positive control (if
// any fails the harness itself is broken and nothing else runs), then every
// other attempt, then the shared sender mode attempts. Quote Settings is
// put in creator mode for the run, switched to a shared mailbox for the
// shared mode attempts, and put back the way it was at the end. Any FAIL or
// UNEXPECTED exits 1, a broken harness exits 2.
//
// No real email is ever sent: the test companies have no Microsoft
// credentials (checked below before anything runs), their mailbox rows hold
// placeholder tokens, and every send-email attempt is one that must be
// refused before any mail would go out. The success path of the sender
// rules is checked through send-options instead.
//
// The last step, checkHeldEmailApproval, holds an email for approval and
// approves it. With no Microsoft credentials the held email can't be sent,
// which is exactly the failed send it checks: the approval stands, the
// quote returns to DRAFT with the email kept, and nothing is sent twice.
// Everything it changes is put back afterwards.

import bcrypt from "bcryptjs"
import { Prisma, type PrismaClient } from "@/generated/prisma"
import { enforceDevGuard } from "./lib/guard"
import {
  BCRYPT_COST,
  PLACEHOLDER_TOKEN,
  generatePassword,
  loadPermissionFixtureIds,
  loadSampleIds,
  testNames,
  type PermissionFixtureIds,
  type SampleIds,
} from "./lib/test-data"
import { HarnessBroken, Session, errorText, isJsonError, printTable, readBaseUrl, type Method, type Row } from "./lib/harness"
// Only imports Prisma types, so loading it can't reach the database
import { setUserRoles } from "@/lib/user-roles"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("check-permissions")

// ─── ATTEMPTS ────────────────────────────────────────────────────────────────
// Every permission attempt, in one list. To cover more routes in a later
// branch, add entries here.
//
//   actor        who makes the request: admin (Test Admin B, Global Admin),
//                rep (Test Rep B), everyone (Test Everyone B), or sender
//                (Test Sender B: pages.quotes, quotes.sendEmail, and
//                quotes.viewAllUsersQuotes, made by this script, with a
//                mailbox of its own)
//   kind         control: must succeed, and if it doesn't the harness is
//                broken and nothing else runs. allowed: must succeed.
//                refused: must be refused with exactly expect, and must not
//                change any data.
//   expect       the status: 200, 307 (a redirect the route answers with),
//                400, 403 (missing permission), or 404 (a record the user
//                may not open)
//   expectError  text a refusal must contain, so a refusal for some other
//                reason can't pass
//   location     text a 307 redirect's Location must contain
//   contains / notContains   text the response must or must not include
//   check        extra checks on a successful JSON response, returning a
//                problem or null
//   sharedMode   runs with Quote Settings set to send every quote from Test
//                Admin B's mailbox ("admin") or Test Sender B's ("sender")

type Actor = "admin" | "rep" | "everyone" | "sender"

interface AttemptContext {
  b: SampleIds
  c: SampleIds
  fx: PermissionFixtureIds
  fxC: PermissionFixtureIds
  names: ReturnType<typeof testNames>
  senderMailboxId: string
  repUserId: string
  // A made up id, for routes that check the permission before the record
  fakeId: string
}

interface Attempt {
  name: string
  actor: Actor
  kind: "control" | "allowed" | "refused"
  method: Method
  path: (c: AttemptContext) => string
  body?: (c: AttemptContext) => unknown
  expect: 200 | 307 | 400 | 403 | 404
  expectError?: string
  location?: string
  contains?: (c: AttemptContext) => string[]
  notContains?: (c: AttemptContext) => string[]
  check?: (json: unknown, c: AttemptContext, prisma: PrismaClient) => Promise<string | null> | string | null
  sharedMode?: "admin" | "sender"
}

// A complete send-email body, so a send attempt can only be refused for
// the reason under test. Never sent: see the note at the top.
const sendBody = (extra: Record<string, unknown> = {}) => ({
  to: "nobody@example.test",
  subject: "Dev only check, never sent",
  message: "Dev only check, never sent",
  includePdf: false,
  ...extra,
})

const NO_TOKENS = () => [PLACEHOLDER_TOKEN, "accessToken", "refreshToken"]

interface SendOptionsJson {
  defaultConnectionId: string | null
  canChooseSender: boolean
  options: { connectionId: string; email: string; isShared: boolean }[]
}

function sendOptions(json: unknown): SendOptionsJson {
  return json as SendOptionsJson
}

const ATTEMPTS: Attempt[] = [
  // ── Positive controls: Global Admin B ──
  { name: "List quotes shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/quotes", expect: 200, contains: (c) => [c.b.quoteId, c.fx.repQuoteId] },
  { name: "Open own quote, with cost", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 200, contains: (c) => [c.b.quoteId, '"cost"'] },
  { name: "Open the Rep's quote", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 200, contains: (c) => [c.fx.repQuoteId] },
  { name: "Edit own quote", actor: "admin", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}`, body: (c) => ({ title: c.names.quote }), expect: 200, contains: (c) => [c.b.quoteId] },
  { name: "Edit own quote line item", actor: "admin", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, body: (c) => ({ name: c.names.quoteLine }), expect: 200, contains: (c) => [c.b.quoteLineId] },
  { name: "Quote approvals", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/approvals`, expect: 200, contains: () => ["["] },
  { name: "Quote comments", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, expect: 200, contains: () => ["["] },
  { name: "Quote versions", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 200, contains: (c) => [c.b.quoteId] },
  { name: "Quote scorecard", actor: "admin", kind: "control", method: "GET", path: () => "/api/quote-scorecard", expect: 200, contains: () => ["totalQuotes"] },
  { name: "Quote settings", actor: "admin", kind: "control", method: "GET", path: () => "/api/quote-settings", expect: 200, contains: () => ["quotePrefix"] },
  { name: "Quote templates", actor: "admin", kind: "control", method: "GET", path: () => "/api/quote-templates", expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Open a quote template", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/quote-templates/${c.b.templateId}`, expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Edit a quote template", actor: "admin", kind: "control", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}`, body: (c) => ({ name: c.names.template }), expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Distributor search", actor: "admin", kind: "control", method: "GET", path: () => "/api/distributor-search?q=test", expect: 200, contains: () => ["products"] },
  { name: "Open quotes widget", actor: "admin", kind: "control", method: "GET", path: () => "/api/dashboards/widget-data?type=OPEN_QUOTES", expect: 200, contains: () => ["count"] },
  { name: "Mailbox list shows every mailbox, no tokens", actor: "admin", kind: "control", method: "GET", path: () => "/api/microsoft-connections", expect: 200, contains: (c) => [c.fx.adminMailboxId, c.senderMailboxId], notContains: NO_TOKENS },
  {
    name: "Send options: may choose, owner's mailbox by default",
    actor: "admin",
    kind: "control",
    method: "GET",
    path: (c) => `/api/quotes/${c.b.quoteId}/send-options`,
    expect: 200,
    notContains: NO_TOKENS,
    check: (json, c) => {
      const o = sendOptions(json)
      const ids = o.options.map((x) => x.connectionId)
      if (!o.canChooseSender) return "canChooseSender should be true"
      if (o.defaultConnectionId !== c.fx.adminMailboxId) return "default should be the quote owner's mailbox"
      if (!ids.includes(c.fx.adminMailboxId) || !ids.includes(c.senderMailboxId)) return "options should list every company mailbox"
      if (ids.includes(c.fxC.adminMailboxId)) return "options include another company's mailbox"
      return null
    },
  },

  // ── Positive controls: Test Rep B (pages.quotes, quotes.create, quotes.edit) ──
  { name: "List quotes shows only own", actor: "rep", kind: "control", method: "GET", path: () => "/api/quotes", expect: 200, contains: (c) => [c.fx.repQuoteId], notContains: (c) => [c.b.quoteId] },
  { name: "Open own quote, with cost", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 200, contains: (c) => [c.fx.repQuoteId, '"cost"'] },
  { name: "Edit own quote", actor: "rep", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, body: (c) => ({ title: c.names.repQuote }), expect: 200, contains: (c) => [c.fx.repQuoteId] },
  { name: "Edit own quote line item", actor: "rep", kind: "control", method: "PATCH", path: (c) => `/api/quotes/${c.fx.repQuoteId}/line-items/${c.fx.repQuoteLineId}`, body: (c) => ({ name: c.names.repQuoteLine }), expect: 200, contains: (c) => [c.fx.repQuoteLineId] },
  { name: "Own quote comments", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/comments`, expect: 200, contains: () => ["["] },
  { name: "Own quote versions", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/versions`, expect: 200, contains: (c) => [c.fx.repQuoteId], notContains: (c) => [c.b.quoteId] },
  { name: "Own quote approvals", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/approvals`, expect: 200, contains: () => ["["] },
  { name: "Template picker", actor: "rep", kind: "control", method: "GET", path: () => "/api/quote-templates", expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Open a quote template", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/quote-templates/${c.b.templateId}`, expect: 200, contains: (c) => [c.b.templateId] },
  { name: "Distributor search picker", actor: "rep", kind: "control", method: "GET", path: () => "/api/distributor-search?q=test", expect: 200, contains: () => ["products"] },
  { name: "Quote settings", actor: "rep", kind: "control", method: "GET", path: () => "/api/quote-settings", expect: 200, contains: () => ["quotePrefix"] },
  {
    name: "Scorecard counts only own quotes",
    actor: "rep",
    kind: "control",
    method: "GET",
    path: () => "/api/quote-scorecard",
    expect: 200,
    check: async (json, c, prisma) => {
      const total = (json as { totalQuotes?: number }).totalQuotes
      const [own, all] = await Promise.all([
        prisma.quote.count({ where: { companyId: c.b.companyId, userId: c.repUserId, isActive: true } }),
        prisma.quote.count({ where: { companyId: c.b.companyId, isActive: true } }),
      ])
      if (own === all) return "test data problem: the Rep owns every active quote, so the scoping can't be seen"
      return total === own ? null : `totalQuotes is ${total}, the Rep owns ${own} active quotes`
    },
  },
  {
    name: "Open quotes widget counts only own quotes",
    actor: "rep",
    kind: "control",
    method: "GET",
    path: () => "/api/dashboards/widget-data?type=OPEN_QUOTES",
    expect: 200,
    check: async (json, c, prisma) => {
      const count = (json as { count?: number }).count
      const own = await prisma.quote.count({
        where: { companyId: c.b.companyId, userId: c.repUserId, status: { in: ["DRAFT", "PENDING_APPROVAL", "SENT", "VIEWED"] } },
      })
      return count === own ? null : `count is ${count}, the Rep has ${own} open quotes`
    },
  },

  // ── Positive controls: Test Sender B and Test Everyone B ──
  {
    name: "Send options: own mailbox only, can't choose",
    actor: "sender",
    kind: "control",
    method: "GET",
    path: (c) => `/api/quotes/${c.b.quoteId}/send-options`,
    expect: 200,
    notContains: (c) => [...NO_TOKENS(), c.fx.adminMailboxId, c.names.adminMailboxEmail],
    check: (json, c) => {
      const o = sendOptions(json)
      if (o.canChooseSender) return "canChooseSender should be false"
      if (o.defaultConnectionId !== c.senderMailboxId) return "default should be the sender's own mailbox, not the quote owner's"
      if (o.options.length !== 1 || o.options[0].connectionId !== c.senderMailboxId) return "options should hold only the default"
      return null
    },
  },
  { name: "Mailbox list shows only own", actor: "sender", kind: "control", method: "GET", path: () => "/api/microsoft-connections", expect: 200, contains: (c) => [c.senderMailboxId], notContains: (c) => [...NO_TOKENS(), c.fx.adminMailboxId] },
  { name: "Quote settings (any signed in user)", actor: "everyone", kind: "control", method: "GET", path: () => "/api/quote-settings", expect: 200, contains: () => ["quotePrefix"] },
  {
    name: "Mailbox list is empty (owns none)",
    actor: "everyone",
    kind: "control",
    method: "GET",
    path: () => "/api/microsoft-connections",
    expect: 200,
    check: (json) => (Array.isArray(json) && json.length === 0 ? null : "expected an empty list"),
  },

  // ── Test Everyone B: no permissions, refused everywhere ──
  { name: "List quotes", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/quotes", expect: 403, expectError: "permission" },
  { name: "Create a quote", actor: "everyone", kind: "refused", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.b.clientId }), expect: 403, expectError: "permission" },
  { name: "Open admin's quote", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 404, expectError: "Not found" },
  { name: "Open Rep's quote", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 404, expectError: "Not found" },
  { name: "Edit a quote", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit quotes" },
  { name: "Delete a quote", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 403, expectError: "delete quotes" },
  { name: "Quote approvals", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/approvals`, expect: 404, expectError: "Not found" },
  { name: "Approve", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/approvals/${c.fakeId}/approve`, expect: 403, expectError: "approve quotes" },
  { name: "Reject", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/approvals/${c.fakeId}/reject`, body: () => ({ reason: "x" }), expect: 403, expectError: "reject quotes" },
  { name: "Assign", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/assign`, body: (c) => ({ userId: c.fx.everyoneUserId }), expect: 403, expectError: "edit quotes" },
  { name: "Read comments", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Post a comment", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404, expectError: "Not found" },
  { name: "Mark comments viewed", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/mark-comments-viewed`, expect: 404, expectError: "Not found" },
  { name: "Download PDF", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/pdf`, expect: 404, expectError: "Not found" },
  { name: "Copy", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/copy`, expect: 403, expectError: "create quotes" },
  { name: "Flag", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/flag`, expect: 403, expectError: "edit quotes" },
  { name: "Reactivate", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/reactivate`, expect: 403, expectError: "edit quotes" },
  { name: "Add a section", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "edit quotes" },
  { name: "Remove a section", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "edit quotes" },
  { name: "Add a line item", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "edit quotes" },
  { name: "Edit a line item", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "edit quotes" },
  { name: "Delete a line item", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, expect: 403, expectError: "edit quotes" },
  { name: "Mark as sent", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send`, expect: 403, expectError: "status" },
  { name: "Change status", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/status`, body: () => ({ status: "DRAFT" }), expect: 403, expectError: "status" },
  { name: "List versions", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "New version", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 403, expectError: "create quotes" },
  { name: "Send by email", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody(), expect: 403, expectError: "send quotes" },
  { name: "Send options", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/send-options`, expect: 403, expectError: "send quotes" },
  { name: "Quote scorecard", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/quote-scorecard", expect: 403, expectError: "permission" },
  { name: "List templates", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/quote-templates", expect: 403, expectError: "permission" },
  { name: "Open a template", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/quote-templates/${c.b.templateId}`, expect: 403, expectError: "permission" },
  { name: "Create a template", actor: "everyone", kind: "refused", method: "POST", path: () => "/api/quote-templates", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Edit a template", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "quote templates" },
  { name: "Add a template line item", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Edit a template line item", actor: "everyone", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items/${c.fakeId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "quote templates" },
  { name: "Delete a template line item", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items/${c.fakeId}`, expect: 403, expectError: "quote templates" },
  { name: "Add a template section", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Remove a template section", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Distributor search", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/distributor-search?q=test", expect: 403, expectError: "search distributors" },
  { name: "Open quotes widget", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/dashboards/widget-data?type=OPEN_QUOTES", expect: 403, expectError: "permission" },
  { name: "Disconnect the admin's mailbox", actor: "everyone", kind: "refused", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.fx.adminMailboxId}`, expect: 404, expectError: "Not found" },
  // Any signed in user may start connecting their own mailbox. The test
  // company has no Microsoft credentials, so the route stops there, which
  // shows it got past the access check without reaching Microsoft.
  { name: "Start connecting own mailbox", actor: "everyone", kind: "allowed", method: "GET", path: () => "/api/microsoft/connect?label=Dev%20check", expect: 307, location: "missing_credentials" },
  { name: "Mailbox callback without a code", actor: "everyone", kind: "allowed", method: "GET", path: () => "/api/microsoft/callback", expect: 307, location: "invalid_state" },

  // ── Test Rep B: refused what it lacks, and other people's quotes ──
  { name: "Open admin's quote", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}`, expect: 404, expectError: "Not found" },
  { name: "Edit admin's quote", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}`, body: () => ({ title: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Delete own quote", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.fx.repQuoteId}`, expect: 403, expectError: "delete quotes" },
  { name: "Edit admin's line item", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.b.quoteId}/line-items/${c.b.quoteLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Edit admin's line item under own quote", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quotes/${c.fx.repQuoteId}/line-items/${c.b.quoteLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Delete admin's line item under own quote", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/quotes/${c.fx.repQuoteId}/line-items/${c.b.quoteLineId}`, expect: 404, expectError: "Not found" },
  { name: "Add a line item to admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Read admin's comments", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Comment on admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404, expectError: "Not found" },
  { name: "Mark admin's comments viewed", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/mark-comments-viewed`, expect: 404, expectError: "Not found" },
  { name: "Download admin's PDF", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/pdf`, expect: 404, expectError: "Not found" },
  { name: "Admin's quote approvals", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/approvals`, expect: 404, expectError: "Not found" },
  { name: "Admin's quote versions", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "Copy admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/copy`, expect: 404, expectError: "Not found" },
  { name: "New version of admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "Flag admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/flag`, expect: 404, expectError: "Not found" },
  { name: "Reactivate admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/reactivate`, expect: 404, expectError: "Not found" },
  { name: "Add a section to admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Assign admin's quote to self", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/assign`, body: (c) => ({ userId: c.repUserId }), expect: 404, expectError: "Not found" },
  { name: "Assign own quote to another company's user", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.c.adminId }), expect: 400, expectError: "Invalid user" },
  { name: "Approve", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/approvals/${c.fakeId}/approve`, expect: 403, expectError: "approve quotes" },
  { name: "Reject", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/approvals/${c.fakeId}/reject`, body: () => ({ reason: "x" }), expect: 403, expectError: "reject quotes" },
  { name: "Mark own quote as sent", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send`, expect: 403, expectError: "status" },
  { name: "Change own quote status", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/status`, body: () => ({ status: "DECLINED" }), expect: 403, expectError: "status" },
  { name: "Send own quote by email", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-email`, body: () => sendBody(), expect: 403, expectError: "send quotes" },
  { name: "Send own quote as the admin's mailbox", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-email`, body: (c) => sendBody({ sendAsConnectionId: c.fx.adminMailboxId }), expect: 403, expectError: "send quotes" },
  { name: "Send options", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-options`, expect: 403, expectError: "send quotes" },
  { name: "Create a template", actor: "rep", kind: "refused", method: "POST", path: () => "/api/quote-templates", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Edit a template", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.b.templateId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: "quote templates" },
  { name: "Add a template line item", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Add a template section", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Remove a template section", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/quote-templates/${c.b.templateId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: "quote templates" },
  { name: "Disconnect the admin's mailbox", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.fx.adminMailboxId}`, expect: 404, expectError: "Not found" },

  // ── Test Sender B: may send, but only from its own mailbox ──
  { name: "Send as the admin's mailbox", actor: "sender", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: (c) => sendBody({ sendAsConnectionId: c.fx.adminMailboxId }), expect: 403, expectError: "send as another mailbox" },

  // ── Global Admin B: refused before any mail would go out ──
  { name: "Send as another company's mailbox", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: (c) => sendBody({ sendAsConnectionId: c.fxC.adminMailboxId }), expect: 400, expectError: "Invalid mailbox" },
  { name: "Send to an invalid address", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody({ to: "not-an-address" }), expect: 400, expectError: "not a valid email address" },
  { name: "Send to too many recipients", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody({ to: Array.from({ length: 26 }, (_, i) => `nobody${i}@example.test`).join(", ") }), expect: 400, expectError: "at most" },
  { name: "Send with no message", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/send-email`, body: () => sendBody({ message: "" }), expect: 400, expectError: "required" },

  // ── Shared sender mode (Quote Settings sends from Test Admin B's mailbox) ──
  {
    name: "Send options in shared mode: shared mailbox for everyone",
    actor: "sender",
    kind: "allowed",
    sharedMode: "admin",
    method: "GET",
    path: (c) => `/api/quotes/${c.b.quoteId}/send-options`,
    expect: 200,
    notContains: NO_TOKENS,
    check: (json, c) => {
      const o = sendOptions(json)
      if (o.canChooseSender) return "canChooseSender should be false"
      if (o.defaultConnectionId !== c.fx.adminMailboxId) return "default should be the shared mailbox"
      if (o.options.length !== 1 || !o.options[0].isShared) return "options should hold only the shared mailbox, marked shared"
      return null
    },
  },
  {
    name: "Send options in shared mode: holder sees the shared mailbox marked",
    actor: "admin",
    kind: "allowed",
    sharedMode: "admin",
    method: "GET",
    path: (c) => `/api/quotes/${c.fx.repQuoteId}/send-options`,
    expect: 200,
    notContains: NO_TOKENS,
    check: (json, c) => {
      const o = sendOptions(json)
      if (o.defaultConnectionId !== c.fx.adminMailboxId) return "default should be the shared mailbox"
      const shared = o.options.find((x) => x.connectionId === c.fx.adminMailboxId)
      return shared?.isShared ? null : "the shared mailbox should be marked isShared"
    },
  },
  { name: "Disconnect someone else's shared mailbox", actor: "sender", kind: "refused", sharedMode: "admin", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.fx.adminMailboxId}`, expect: 404, expectError: "Not found" },
  // Even one's own mailbox needs Integrations access while it is the shared sender
  { name: "Disconnect own mailbox while it is the shared sender", actor: "sender", kind: "refused", sharedMode: "sender", method: "DELETE", path: (c) => `/api/microsoft-connections/${c.senderMailboxId}`, expect: 403, expectError: "shared quote sender" },
]

// ─── HARNESS ─────────────────────────────────────────────────────────────────

// Everything an attempt could touch in Test Company B (and Test Company C's
// mailboxes, for the cross company sender attempt), compared before and
// after each refused attempt that isn't a GET. No token or secret columns
// are read.
async function snapshot(prisma: PrismaClient, b: string, c: string): Promise<Record<string, string>> {
  const byId = { orderBy: { id: "asc" as const } }
  const sections = {
    quotes: prisma.quote.findMany({
      where: { companyId: b },
      ...byId,
      include: { lineItems: byId, comments: byId, approvals: byId },
    }),
    quoteTemplates: prisma.quoteTemplate.findMany({ where: { companyId: b }, ...byId, include: { lineItems: byId } }),
    mailboxes: prisma.microsoftConnection.findMany({
      where: { companyId: { in: [b, c] } },
      ...byId,
      select: { id: true, companyId: true, email: true, label: true, connectedByUserId: true, updatedAt: true },
    }),
    settings: prisma.companySettings.findUnique({
      where: { companyId: b },
      select: { quoteSendFromMode: true, quoteSendFromConnectionId: true, updatedAt: true },
    }),
    roles: prisma.role.findMany({ where: { companyId: b }, ...byId }),
    users: prisma.user.findMany({ where: { companyId: b }, ...byId, select: { id: true, active: true, roleId: true } }),
    notifications: prisma.notification.count({ where: { companyId: b } }),
  }
  const keys = Object.keys(sections) as (keyof typeof sections)[]
  const values = await Promise.all(keys.map((k) => sections[k]))
  return Object.fromEntries(keys.map((k, i) => [k, JSON.stringify(values[i])]))
}

function changedSections(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(after).filter((k) => before[k] !== after[k])
}

// Test Sender B inside Test Company B, reset to the same known state every
// run, with its own mailbox row (placeholder tokens). The password exists
// only in memory for this run.
async function ensureSenderFixture(prisma: PrismaClient, b: SampleIds) {
  const n = testNames("B")
  const companyId = b.companyId
  const senderPermissions = { pages: { quotes: true }, quotes: { sendEmail: true, viewAllUsersQuotes: true } }

  const existingRole = await prisma.role.findFirst({ where: { companyId, name: n.senderRole } })
  const role = existingRole
    ? await prisma.role.update({ where: { id: existingRole.id }, data: { rank: 6, permissions: senderPermissions } })
    : await prisma.role.create({ data: { companyId, name: n.senderRole, rank: 6, permissions: senderPermissions } })

  const password = generatePassword(20)
  const hashed = await bcrypt.hash(password, BCRYPT_COST)
  const existing = await prisma.user.findUnique({ where: { email: n.senderEmail } })
  if (existing && existing.companyId !== companyId) {
    throw new HarnessBroken(`${n.senderEmail} belongs to a different company, refusing to change it`)
  }
  const reset = { password: hashed, active: true, mustChangePassword: false, loginFailedAttempts: 0, loginLockedUntil: null }
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name: n.senderName, ...reset } })
    : await prisma.user.create({ data: { companyId, name: n.senderName, email: n.senderEmail, ...reset } })
  await setUserRoles(prisma, user.id, [role.id])

  const mailbox = await prisma.microsoftConnection.upsert({
    where: { companyId_email: { companyId, email: n.senderMailboxEmail } },
    update: { label: n.senderName, connectedByUserId: user.id, accessToken: PLACEHOLDER_TOKEN, refreshToken: PLACEHOLDER_TOKEN },
    create: {
      companyId,
      email: n.senderMailboxEmail,
      label: n.senderName,
      connectedByUserId: user.id,
      accessToken: PLACEHOLDER_TOKEN,
      refreshToken: PLACEHOLDER_TOKEN,
    },
    select: { id: true },
  })

  return { email: n.senderEmail, password, mailboxId: mailbox.id }
}

// A held email whose send fails must not strand the quote. Runs as Test
// Admin B on its own sample quote, using the sample approval workflow
// switched on for the duration, and puts everything back at the end.
async function checkHeldEmailApproval(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const quoteId = ctx.b.quoteId
  const workflowId = ctx.b.workflowId
  const label = (name: string) => `[Admin B] Held email: ${name}`
  const row = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })

  const workflow = await prisma.approvalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  try {
    // Every send of this company's quotes now needs approval
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: true, triggerType: "TOTAL_THRESHOLD", thresholdValue: 0, triggerUserId: null },
    })

    const send = await admin.request("POST", `/api/quotes/${quoteId}/send-email`, { json: sendBody() })
    const heldQuote = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, pendingEmailPayload: true } })
    const heldOk = send.status === 200 && send.text.includes('"pendingApproval":true') && heldQuote.status === "PENDING_APPROVAL"
    row("send is held for approval", "200, PENDING_APPROVAL", `${send.status}, ${heldQuote.status}`, heldOk ? null : errorText(send.text))
    if (!heldOk) return

    const approval = await prisma.quoteApproval.findFirst({ where: { quoteId, workflowId, status: "PENDING" }, select: { id: true } })
    if (!approval) {
      row("approval was requested", "a pending approval", "none", "no pending approval was created")
      return
    }

    // The send can't succeed (no Microsoft credentials), so this is the failed send path
    const approve = await admin.request("POST", `/api/quotes/${quoteId}/approvals/${approval.id}/approve`)
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, pendingEmailPayload: true } })
    const decided = await prisma.quoteApproval.findUniqueOrThrow({ where: { id: approval.id }, select: { status: true } })
    const kept = after.pendingEmailPayload as { lastSendError?: string } | null
    let warning = ""
    try {
      warning = (JSON.parse(approve.text) as { warning?: string }).warning ?? ""
    } catch {
      // not JSON, reported below
    }
    const problem =
      approve.status !== 200
        ? `approve returned ${approve.status}: ${errorText(approve.text)}`
        : !warning
          ? "no warning in the response"
          : decided.status !== "APPROVED"
            ? `approval is ${decided.status}`
            : after.status !== "DRAFT"
              ? `quote is ${after.status}`
              : !kept?.lastSendError
                ? "the held email was not kept"
                : null
    row("failed send keeps the approval and the email", "200 with warning, APPROVED, DRAFT", `${approve.status}, ${decided.status}, ${after.status}`, problem)

    const again = await admin.request("POST", `/api/quotes/${quoteId}/approvals/${approval.id}/approve`)
    const unchanged = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })
    row(
      "approving again is refused",
      '400 "already been decided"',
      String(again.status),
      again.status === 400 && errorText(again.text).includes("already been decided") && unchanged.status === "DRAFT"
        ? null
        : `got ${again.status} (${errorText(again.text)}), quote is ${unchanged.status}`
    )

    // The owner sending it again counts the approval already granted: it is
    // not held a second time (and still can't go out without credentials)
    const resend = await admin.request("POST", `/api/quotes/${quoteId}/send-email`, { json: sendBody() })
    const resent = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })
    const pendingAgain = await prisma.quoteApproval.count({ where: { quoteId, status: "PENDING" } })
    row(
      "owner resend is not held again",
      "400 (no credentials), DRAFT, no new approval",
      `${resend.status}, ${resent.status}, ${pendingAgain} pending`,
      resend.status === 400 && resent.status === "DRAFT" && pendingAgain === 0 ? null : errorText(resend.text)
    )
  } finally {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: {
        active: workflow.active,
        triggerType: workflow.triggerType,
        thresholdValue: workflow.thresholdValue,
        triggerUserId: workflow.triggerUserId,
      },
    })
    await prisma.quoteApproval.deleteMany({ where: { quoteId } })
    await prisma.quote.update({ where: { id: quoteId }, data: { status: "DRAFT", pendingEmailPayload: Prisma.JsonNull } })
  }
}

function expectedText(a: Attempt) {
  if (a.location) return `${a.expect} to ${a.location}`
  return `${a.expect}${a.expectError ? ` "${a.expectError}"` : ""}`
}

async function judgeSuccess(a: Attempt, res: { status: number; text: string; location: string }, ctx: AttemptContext, prisma: PrismaClient) {
  if (res.status !== a.expect) return `got ${res.status}: ${errorText(res.text)}`
  if (a.location && !res.location.includes(a.location)) return `redirected to ${res.location || "nowhere"}`
  const missing = (a.contains?.(ctx) ?? []).filter((t) => !res.text.includes(t))
  if (missing.length > 0) return `response is missing ${missing.slice(0, 3).join(", ")}`
  const present = (a.notContains?.(ctx) ?? []).filter((t) => res.text.includes(t))
  if (present.length > 0) return `response must not contain ${present.slice(0, 3).join(", ")}`
  if (a.check) {
    let json: unknown
    try {
      json = JSON.parse(res.text)
    } catch {
      return "response is not JSON"
    }
    return await a.check(json, ctx, prisma)
  }
  return null
}

function judgeRefusal(a: Attempt, res: { status: number; text: string }, changed: string[]): Pick<Row, "result" | "note"> {
  const message = errorText(res.text)
  if (changed.length > 0) return { result: "FAIL", note: `data changed: ${changed.join(", ")}` }
  if (res.status >= 200 && res.status < 300) return { result: "FAIL", note: `request succeeded: ${message}` }
  if (res.status >= 500) return { result: "FAIL", note: `server error: ${message}` }
  if (res.status === a.expect) {
    if (!isJsonError(res.text)) return { result: "UNEXPECTED", note: "not a JSON refusal from the app, the route path may be wrong" }
    if (a.expectError && !message.includes(a.expectError)) return { result: "UNEXPECTED", note: `refused for a different reason: ${message}` }
    return { result: "PASS" }
  }
  if (res.status === 401) return { result: "UNEXPECTED", note: `not signed in: ${message}` }
  if (res.status >= 300 && res.status < 400) return { result: "UNEXPECTED", note: "redirected, the harness may not be signed in" }
  if (res.status === 403 || res.status === 404 || res.status === 400) {
    return { result: "UNEXPECTED", note: `refused, but with ${res.status}: ${message}` }
  }
  return { result: "FAIL", note: `wrong refusal: ${message}` }
}

async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  const passwords = {
    admin: process.env.TEST_ADMIN_B_PASSWORD,
    rep: process.env.TEST_REP_B_PASSWORD,
    everyone: process.env.TEST_EVERYONE_B_PASSWORD,
  }
  const missing = [
    !passwords.admin && "TEST_ADMIN_B_PASSWORD",
    !passwords.rep && "TEST_REP_B_PASSWORD",
    !passwords.everyone && "TEST_EVERYONE_B_PASSWORD",
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new HarnessBroken(`Set ${missing.join(", ")} in your shell (the passwords create-test-companies printed).`)
  }

  // Imported only after the guard passed
  const { prisma } = await import("@/lib/prisma")
  const rows: Row[] = []

  const b = await loadSampleIds(prisma, "B")
  const c = await loadSampleIds(prisma, "C")
  const fx = await loadPermissionFixtureIds(prisma, "B")
  const fxC = await loadPermissionFixtureIds(prisma, "C")

  // Safety: with no Microsoft credentials a quote email can't be sent from
  // these companies even if a refusal below were broken. Only whether the
  // values exist is read, never the values.
  const credentials = await prisma.companySettings.findMany({
    where: { companyId: { in: [b.companyId, c.companyId] } },
    select: { microsoftClientId: true, microsoftClientSecret: true },
  })
  if (credentials.some((s) => s.microsoftClientId || s.microsoftClientSecret)) {
    throw new HarnessBroken("A test company has Microsoft credentials set, so a broken refusal could send a real email. Remove them from the test company first.")
  }
  const quotes = await prisma.quote.findMany({ where: { id: { in: [b.quoteId, fx.repQuoteId] } }, select: { status: true } })
  if (quotes.length !== 2 || quotes.some((q) => q.status !== "DRAFT")) {
    throw new HarnessBroken("The sample quotes must be drafts. Run create-test-companies again to reset them.")
  }

  // Creator mode for the run, put back the way it was at the end
  const originalSettings = await prisma.companySettings.findUnique({
    where: { companyId: b.companyId },
    select: { quoteSendFromMode: true, quoteSendFromConnectionId: true },
  })
  async function setSenderMode(mode: "CREATOR" | "SPECIFIC", connectionId: string | null) {
    await prisma.companySettings.upsert({
      where: { companyId: b.companyId },
      update: { quoteSendFromMode: mode, quoteSendFromConnectionId: connectionId },
      create: { companyId: b.companyId, quoteSendFromMode: mode, quoteSendFromConnectionId: connectionId },
    })
  }
  try {
    return await runChecks()
  } finally {
    await setSenderMode(
      originalSettings?.quoteSendFromMode === "SPECIFIC" ? "SPECIFIC" : "CREATOR",
      originalSettings?.quoteSendFromConnectionId ?? null
    )
    await prisma.$disconnect()
  }

  async function runChecks() {
    await setSenderMode("CREATOR", null)
    const sender = await ensureSenderFixture(prisma, b)
    const names = testNames("B")
    const ctx: AttemptContext = {
      b,
      c,
      fx,
      fxC,
      names,
      senderMailboxId: sender.mailboxId,
      repUserId: fx.repUserId,
      fakeId: "devonlynotarealid000000000",
    }

    // Sign in
    const sessions: Record<Actor, Session> = {
      admin: new Session("Test Admin B", baseUrl),
      rep: new Session("Test Rep B", baseUrl),
      everyone: new Session("Test Everyone B", baseUrl),
      sender: new Session("Test Sender B", baseUrl),
    }
    await sessions.admin.signIn(names.adminEmail, passwords.admin as string)
    await sessions.rep.signIn(names.repEmail, passwords.rep as string)
    await sessions.everyone.signIn(names.everyoneEmail, passwords.everyone as string)
    await sessions.sender.signIn(sender.email, sender.password)
    console.log(`Signed in to ${baseUrl} as Test Admin B, Test Rep B, Test Everyone B, and Test Sender B.`)

    const ACTOR_LABEL: Record<Actor, string> = { admin: "Admin B", rep: "Rep B", everyone: "Everyone B", sender: "Sender B" }
    const label = (a: Attempt) => `[${a.kind === "control" ? "control " : ""}${ACTOR_LABEL[a.actor]}] ${a.name}`

    // Positive controls first: if any fails, the refusals below would prove nothing
    for (const a of ATTEMPTS.filter((x) => x.kind === "control" && !x.sharedMode)) {
      const res = await sessions[a.actor].request(a.method, a.path(ctx), { json: a.body?.(ctx) })
      const problem = await judgeSuccess(a, res, ctx, prisma)
      rows.push({ attempt: label(a), expected: expectedText(a), actual: String(res.status), result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
      if (problem) {
        printTable(rows)
        throw new HarnessBroken(`Positive control "${label(a)}" failed, so the harness itself is broken. No other attempts were run.`)
      }
    }

    async function runAttempts(list: Attempt[]) {
      let before = await snapshot(prisma, b.companyId, c.companyId)
      for (const a of list) {
        let res: { status: number; text: string; location: string }
        try {
          res = await sessions[a.actor].request(a.method, a.path(ctx), { json: a.body?.(ctx) })
        } catch (err) {
          rows.push({ attempt: label(a), expected: expectedText(a), actual: "no response", result: "UNEXPECTED", note: err instanceof Error ? err.message : String(err) })
          continue
        }

        if (a.kind === "refused") {
          let changed: string[] = []
          if (a.method !== "GET") {
            const after = await snapshot(prisma, b.companyId, c.companyId)
            changed = changedSections(before, after)
            before = after
          }
          rows.push({ attempt: label(a), expected: expectedText(a), actual: String(res.status), ...judgeRefusal(a, res, changed) })
        } else {
          const problem = await judgeSuccess(a, res, ctx, prisma)
          rows.push({ attempt: label(a), expected: expectedText(a), actual: String(res.status), result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
          // Allowed requests may legitimately write (a no-op save still moves
          // updatedAt), so the next refused attempt compares against now
          before = await snapshot(prisma, b.companyId, c.companyId)
        }
      }
    }

    await runAttempts(ATTEMPTS.filter((a) => a.kind !== "control" && !a.sharedMode))

    // Shared sender mode, one shared mailbox at a time
    await setSenderMode("SPECIFIC", fx.adminMailboxId)
    await runAttempts(ATTEMPTS.filter((a) => a.sharedMode === "admin"))
    await setSenderMode("SPECIFIC", sender.mailboxId)
    await runAttempts(ATTEMPTS.filter((a) => a.sharedMode === "sender"))

    // Approval of a held email whose send fails
    await setSenderMode("CREATOR", null)
    await checkHeldEmailApproval(prisma, sessions.admin, ctx, rows)

    printTable(rows)
    const count = (r: Row["result"]) => rows.filter((row) => row.result === r).length
    console.log(`\n${rows.length} checks: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("UNEXPECTED")} UNEXPECTED`)

    return count("FAIL") + count("UNEXPECTED") > 0 ? 1 : 0
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(err instanceof HarnessBroken ? 2 : 1)
  })
