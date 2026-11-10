// DEV ONLY. Proves the permission checks inside one company against the
// locally running dev server: signs in as Test Admin B (Global Admin), Test
// Rep B (only the Rep role), Test Clerk B (only the Clerk role), Test Orders
// B (only the Orders role), Test Templater B (only the Templater role), and
// Test Everyone B (only the Everyone role, with no permissions), all made by
// this run (lib/run-data.ts), plus Test Sender B, Test Viewer B, and Test
// Manager B users this script sets up itself, and checks every attempt in
// the ATTEMPTS list below. It also adds an ad hoc line to Test Orders B's
// purchase order for the received flag checks and removes it at the end.
//
// Refuses to run unless DB_NAME is psasync_dev (see lib/guard.ts), and only
// talks to a server on this machine. Run from the repo root, with the dev
// server running:
//   npx tsx scripts/dev-only/check-permissions.ts --yes
// Optional: --base-url http://localhost:3000 (the default)
// On its own it sets up and removes its own temporary data; run-checks.ts
// runs it with the data it shares between all three checks.
//
// Order of work: guard, safety checks, sign in, every positive control (if
// any fails the harness itself is broken and nothing else runs), then every
// other attempt, then the shared sender mode attempts. Quote Settings is
// put in creator mode for the run, switched to a shared mailbox for the
// shared mode attempts, and put back the way it was at the end. Any FAIL or
// UNEXPECTED exits 1, a broken harness exits 2.
//
// No real email is ever sent and no real distributor is reached: the test
// companies have no Microsoft credentials and no distributor integration
// turned on (findExternalServices, checked before anything runs), and no
// attempt tests a distributor connection. Their mailbox rows hold
// placeholder tokens, and every send-email attempt is one that must be
// refused before any mail would go out. The success path of the sender
// rules is checked through send-options instead.
//
// The step checkHeldEmailApproval holds an email for approval and
// approves it. With no Microsoft credentials the held email can't be sent,
// which is exactly the failed send it checks: the approval stands, the
// quote returns to DRAFT with the email kept, and nothing is sent twice.
// Everything it changes is put back afterwards.
//
// The round two steps after it: checkStatusApproval switches the sample
// workflow on and checks that Test Admin B can't move the draft sample
// quote to SENT or ACCEPTED through the status route (DECLINED works), and
// can with the workflow off. checkStaleApproval has Test Admin B request
// approval with an email (never sent, no credentials), change a line price,
// and Test Approver B (made by this script: the Quotes page and approving,
// not a Global Admin) approve it, which must not send it: the quote goes
// back to DRAFT with the email kept and the approvals no longer counting.
// checkSalesOrderLinkedPurchaseOrders links Test Admin B's second sample
// purchase order to Test Orders B's sales order and checks Orders B can't
// see it there. Each step puts the quote, the workflow, the line price,
// the purchase order link, and any notification it made back.
//
// Quote correctness: checkQuoteCopy has Test Admin B copy the copy fixture
// quote (lib/run-data.ts: a bundle, a choice group with a selected
// option, a text block, an optional line, an adjustable quantity, and a
// recurring line over two sections and an empty one) for the copy client,
// then copy that copy, and Test Rep B copy its own quote. Each copy must
// have the same lines and sections, the chosen client and contact, and the
// copier as its owner, and none of the original's PO number, internal
// notes, or progress. Every copy is deleted afterwards. The refusals cover
// a copy without a client or contact, another company's client or contact,
// a contact of a different client, assigning a quote to someone else
// without quotes.viewAllUsersQuotes, and blank, 0, negative, and
// fractional Default Expiry values.
//
// Opportunities: Test Everyone B is refused every opportunity, stage,
// type, and settings route. Test Rep B (a second role with the
// Opportunities page and create, no see all) sees only its own and the
// unassigned sample opportunity, gets a 404 on the admin's, a 403 naming
// the admin as owner, and may create for itself or unassigned (each
// created row is removed right after). Test Opp Viewer B (only the page)
// reads but can't create, edit, or delete, and Test Opp Settings B (only
// Opportunity Settings) is the only one besides Global Admin whose stage,
// type, and settings writes go through.
//
// Opportunities screens: checkOpportunityPages reads the Opportunities
// page, an opportunity's page, and Settings > Opportunity Settings as HTML
// with each user's session (Test Everyone B, Test Clerk B, and Test Opp
// Settings B get no access to the opportunity pages; Test Everyone B, Test
// Opp Viewer B, and Test Manager B, who opens Settings, to the section).
// checkRelatedVisibility links the admin's sample quote and Test Rep B's
// quote to the unassigned sample opportunity and checks the Related panel
// lists only the ones each user may open, then unlinks them.
// checkStageCategoryClosedAt has Test Opp Settings B move the first stage
// to WON and back, checking closedAt is set and then cleared on the sample
// opportunities in it, and puts the stage and dates back.
//
// Timeline: every timeline route is refused for Test Everyone B, reading
// needs the Opportunities page and the opportunity view check, and adding a
// note needs opportunities.edit (Test Rep B and Test Opp Viewer B are
// refused). Test Admin B, a Global Admin, still can't edit or delete Test
// Rep B's sample note, and nobody can edit or delete an action entry.
// checkTimeline has Test Admin B add a note holding a script tag (stored
// and returned without it), edit and delete it, and checks that a stage
// change through PATCH adds exactly one stage_changed entry and a PATCH
// that changes nothing adds none, then puts everything back.
// checkNoteStageChange posts notes with a stageId (to a WON stage, then an
// OPEN one), checking the stage moves, closedAt is set and cleared, and each
// adds exactly one entry, the note holding the move. A note with a stageId
// is refused without opportunities.edit, and with another company's, a made
// up, or a non text stageId. The opportunity GET's client details reach
// only users who may open it, and the list never carries them.
// checkOpportunityLocation checks a create without a location saves the
// client's main location, another of the client's locations saves with one
// location_changed entry (none when saved again), and a client change resets
// the location to the new client's main one. A location of another client
// of the same company is refused (400). The contact's mobile comes only with
// an opportunity the user may open.
//
// Creating an opportunity needs an initial note (OPP_NOTE on every create
// attempt); one left out, empty, or script only (empty after sanitizing) is
// refused with 400, and a create without an owner is unassigned.
//
// Audit log (AUDIT_ATTEMPTS): the lists need auditLog.view and undo and
// restore auditLog.restore (Test Audit Viewer B, made here, reads but can't
// undo or restore). checkAuditRecording has Test Admin B create an
// opportunity and checks each change records the right entries (created,
// field_changed with before and after, a stage moved by a note, note_added,
// note_edited, note_deleted) and a PATCH that changes nothing records none.
// checkSoftDelete deletes it and checks it is gone from the list, the
// sidebar counts, and its opportunity (for Test Opp Viewer B), timeline,
// related, attachments, email options, and email routes (the email is a
// 404 before anything is read or sent), then restores it. checkAuditUndo
// undoes a title change once, is refused after a later change to the same
// field, and is refused while the old owner is out of the team (Test Rep
// B's General membership is put back). The opportunity is removed at the
// end; its audit entries go with the run's teardown. Attachments and emails
// are never added, so their entries are covered by the scratch tests.
//
// Attachment downloads (checkAttachmentDownloads, fixtures downloadFileIds
// in lib/run-data.ts): each kind's download route answers 302 to the
// uploads bucket with a link that expires within 300 seconds for a user
// who may view the parent, the parent's 403 or 404 for one who may not, 404
// for a soft deleted opportunity, 404 "File not available" for a dummy
// example.test link, and no attachment response holds the bucket host.
// The redirect's link is never printed.
//
// Teams (TEAM_ATTEMPTS, fixtures in lib/run-data.ts): the three visibility
// levels on the list, an opportunity, its timeline, its related records,
// and the sidebar counts (Test Team Basic B: own plus the team's
// unassigned; Test Team Viewer B: every one in its team; Test Admin B:
// all), the owner rules (an owner must be in the opportunity's team, and
// only viewTeam or viewAll may pick someone else), the team change rules
// (only to a team the user is in, and an owner outside the new team needs
// a new owner in the same request), Global Admin and Everyone refused as
// default roles, General and a team in use not deleted, and the Teams
// routes and the Settings section gated by settingsSections.teams. Test
// Team Manager B (Teams only, rank 5) can't give a team a role at or above
// its rank, or add a member to a team that has one. checkTeamDefaultRoles
// has Test Everyone B gain the Catalog page by joining Sales, lose it on
// leaving, and keep it when the role is also given directly.
// checkTeamChange moves opportunities between teams (one team_changed
// entry) and puts them back.
//
// The grant rule (src/lib/role-grants.ts): giving a role, directly or
// through a team, needs the giver to rank above it and hold every
// permission it grants. Team Grant (rank 1, the Catalog page) is below Test
// Team Manager B and Test Manager B but grants a permission neither holds,
// so attaching it, adding anyone (themselves included) to Sales, and giving
// it directly in Manage Users are all refused (403). The membership rank
// rule: Test Team Manager B can't add Test Rep B (rank 5, its own rank) to
// Ops or remove Test Admin B from it (403). checkGrantRules then shows the
// legitimate cases go through (Ops' Team Lite removed and attached again,
// Test Team Basic B added, Test Team Manager B removing itself, and Test
// Manager B giving Team Lite directly) and puts everything back.
//
// Action buttons (ACTION_BUTTON_GUARDED and the attempts after it): the
// admin routes need settingsSections.actionButtons (refused for Test
// Everyone B, Test Opp Viewer B, and Test Opp Settings B), the record list
// (?for=opportunity) is readable by Test Opp Viewer B, and bad buttons are
// refused with 400 (a color that isn't #RRGGBB, a fixed stage left out,
// stage settings on a kind that can't change the stage). A stage a button
// moves to can't be deleted (409). A note through a button follows its
// rules: the Lost button refuses an empty note, the Won button refuses
// another stage, and an Email button can't post a note.
// checkActionButtonNotes posts an empty note through Won and a note
// through the custom button, checking each moves to the button's stage
// with one NOTE entry holding the move and the button's label, and puts
// everything back. checkRecordButtonList adds a hidden button and an
// Appointment button through the API, checks the record list leaves both
// out while the admin list has them, refuses a note through the hidden
// one, and deletes both.
//
// The Email action is only ever called with input it refuses before
// anything is sent: without opportunities.edit (403), on an opportunity the
// user can't open (404), with a bad address, more than 20 recipients,
// another opportunity's attachment, a Note button, or a stage the Email
// button doesn't allow (400). The test companies have no Microsoft
// credentials either (findExternalServices), so nothing could go out.
//
// Tickets (TICKET_ATTEMPTS and the ticket steps): the three visibility
// levels on the list, a ticket, its timeline, attachments, and email
// options, and the sidebar counts; the assignment rules with and without
// tickets.assign; the team change rules; the required initial note; the
// ticket settings routes needing settingsSections.tickets, with their 409s
// (in use, the last status of a category, a status a button moves to) and
// 400s; the ticket action button list; and delete, restore, and the ticket
// audit log. checkTicketRoundRobin checks the rotation skips the inactive
// member and is recorded by System, checkTicketStatusTimestamps the
// resolvedAt and closedAt rules, checkTicketAuditFlow undo, soft delete, and
// restore, and checkTicketAutoClose the daily job on Test Company B only
// (closeResolvedTickets with companyIds) and its cron route without a
// secret. Ticket emails are only ever refused before anything is sent.
//
// Record numbers (checkRecordNumbering): Test Admin B creates several
// quotes, sales orders, and purchase orders at the same time with parallel
// requests, and every number must be different, in the company prefix,
// year, and four digit format, and one after another. Deleting the newest
// one and creating another must not reuse its number. Every record it
// makes is deleted at the end; the counters stay until teardown.
//
// Quotes linked to opportunities (checkQuoteOpportunities): Test Admin B
// makes its own quotes and opportunities through the API and changes quote
// statuses only through the status route, so nothing is ever emailed. A
// draft links to an open opportunity of its client and contact (every
// version, and a new version keeps it), and links to a closed, deleted, or
// other client's opportunity are refused, as are Test Rep B linking to a
// Sales opportunity it can't see and Test Opp Viewer B without quote edit
// rights. Sending an unlinked quote creates one opportunity (the owner's
// first team, Ops, with the owner, the quote sent stage, source QUOTE, and a
// system note); accepting moves it to the first Won stage, and the sales
// order and the purchase order generated from it carry the link. Declined
// waits while another linked quote is a draft, then moves to Lost; a manual
// move stays after a status change that isn't an event; the value follows
// the latest sent quote (123.456 shows as 123.46) and the manual value is
// refused; manual orders take the link; and each link and event is on the
// timeline and in the audit log. Everything it made is removed, the
// opportunities the app created included. The sample quote steps above
// (status approval, stale approval) put back the sample quote's link and
// remove any opportunity a send created (saveSampleQuote).
//
// Opportunity rules (checkQuoteOpportunityRules): contactless drafts move to
// Declined and Expired, one at a time and several at once (the bulk actions
// call the status route per quote), creating no opportunity, and sending
// one through the status menu or Mark as sent is refused. Create
// opportunity on an accepted, a declined, and a sent quote lands on the
// first Won stage, the first Lost stage, and the quote sent stage (the
// accepted and sent statuses are written straight to the database, since
// the route would create the opportunity itself). An opportunity with a
// linked quote refuses a new client with 409 and takes a new contact of its
// client (a second contact this step adds and removes).
//
// Quote expiry job (checkQuoteExpiryJob): on Test Company B only (the job's
// companyIds, so no other dev data is touched), a sent quote past its Valid
// until date and linked to an open opportunity expires and moves the
// opportunity to the first Lost stage, by System on the timeline and in the
// audit log, while a sent quote not yet due and a draft past due stay; a
// second run expires nothing. GET /api/cron/expire-quotes without a secret
// and with a made up one answers 401 (the dev server has CRON_SECRET) or 503
// (it doesn't), and the row names which. The real secret is never read or
// sent. Everything it made is removed.

import { Prisma, type PrismaClient } from "@/generated/prisma"
import { enforceDevGuard, findExternalServices } from "./lib/guard"
import { PLACEHOLDER_TOKEN, SAMPLE_ITEM_COST, type PermissionFixtureIds, type SampleIds, type TestNames } from "./lib/test-data"
import { HarnessBroken, ServerUnreachable, Session, checkResult, errorText, fetchOrExplain, isJsonError, printTable, readBaseUrl, type CheckResult, type Method, type Row } from "./lib/harness"
import { addRunMailbox, addRunRole, addRunUser, isEntryScript, withRunData, type RunData } from "./lib/run-data"
// Only imports Prisma types, so loading it can't reach the database
import { setUserRoles } from "@/lib/user-roles"
import { opportunityIdsOf, removeOpportunitiesAddedSince } from "./lib/quote-opportunities"
import { ATTACHMENT_KINDS, attachmentDownloadPath, type AttachmentKind } from "@/lib/attachment-paths"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("check-permissions")

// ─── ATTEMPTS ────────────────────────────────────────────────────────────────
// Every permission attempt, in one list. To cover more routes in a later
// branch, add entries here.
//
//   actor        who makes the request: admin (Test Admin B, Global Admin),
//                rep (Test Rep B), clerk (Test Clerk B), everyone (Test
//                Everyone B), orders (Test Orders B), templater (Test
//                Templater B), sender
//                (Test Sender B: pages.quotes, quotes.sendEmail, and
//                quotes.viewAllUsersQuotes, made by this script, with a
//                mailbox of its own), viewer (Test Viewer B: both order
//                pages and both viewAll keys, no edit, made by this script),
//                manager (Test Manager B: settingsSections.users only,
//                not a Global Admin, made by this script), oppViewer
//                (Test Opp Viewer B: only the Opportunities page), or
//                oppSettings (Test Opp Settings B: only Opportunity
//                Settings). Test Rep B also holds the Opportunities page
//                and opportunities.create, without see all. teamBasic
//                (Test Team Basic B: the Opportunities page, create, and
//                edit, in Sales), teamViewer (Test Team Viewer B: the
//                same plus opportunities.viewTeam, in Sales), or
//                teamManager (Test Team Manager B: only Teams, rank 5).
//   kind         control: must succeed, and if it doesn't the harness is
//                broken and nothing else runs. allowed: must succeed.
//                refused: must be refused with exactly expect, and must not
//                change any data.
//   expect       the status: 200, 307 (a redirect the route answers with),
//                400, 403 (missing permission), 404 (a record the user
//                may not open), or 409 (a delete that is blocked)
//   expectError  text a refusal must contain, so a refusal for some other
//                reason can't pass
//   location     text a 307 redirect's Location must contain
//   contains / notContains   text the response must or must not include
//   check        extra checks on a successful JSON response, returning a
//                problem or null
//   sharedMode   runs with Quote Settings set to send every quote from Test
//                Admin B's mailbox ("admin") or Test Sender B's ("sender")

type Actor =
  | "admin"
  | "rep"
  | "clerk"
  | "everyone"
  | "sender"
  | "orders"
  | "templater"
  | "viewer"
  | "manager"
  | "oppViewer"
  | "oppSettings"
  | "teamBasic"
  | "teamViewer"
  | "teamManager"
  | "auditViewer"
  | "ticketBasic"
  | "ticketViewer"
  | "ticketDispatcher"
  | "ticketSettings"

interface AttemptContext {
  b: SampleIds
  c: SampleIds
  fx: PermissionFixtureIds
  fxC: PermissionFixtureIds
  names: TestNames
  // Test Company C's names, for the invite of another company's email
  namesC: TestNames
  senderMailboxId: string
  repUserId: string
  // Test Manager B's own role, and the ad hoc purchase order line this
  // script adds (both from the fixtures below)
  managerRoleId: string
  untrackedPoLineId: string
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
  expect: 200 | 307 | 400 | 403 | 404 | 409
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

// Every guarded route for clients, catalog, vendors, company settings lists,
// and inventory. Test Everyone B and Test Rep B hold none of these
// permissions, so each one is refused for both with a 403 before any record
// is looked up. clerk marks the ones Test Clerk B is refused too (settings,
// deletes, and Remove). Writes carry a body that would change data if the
// check were missing, so the snapshot catches a leak.
interface Guarded {
  name: string
  method: Method
  path: (c: AttemptContext) => string
  body?: (c: AttemptContext) => unknown
  expectError: string
  clerk?: true
}

const GUARDED: Guarded[] = [
  // Clients and contacts
  { name: "Create a client", method: "POST", path: () => "/api/clients", body: () => ({ name: "Should Not Exist" }), expectError: "create clients" },
  { name: "Import clients", method: "POST", path: () => "/api/clients/import", body: () => ({ rows: [{ name: "Should Not Exist" }] }), expectError: "create clients" },
  { name: "Edit a client", method: "PATCH", path: (c) => `/api/clients/${c.b.clientId}`, body: () => ({ name: "Changed" }), expectError: "edit clients" },
  { name: "Add a client contact", method: "POST", path: (c) => `/api/clients/${c.b.clientId}/contacts`, body: () => ({ firstName: "Should", lastName: "Not Exist" }), expectError: "edit clients" },
  { name: "Edit a client contact", method: "PATCH", path: (c) => `/api/clients/${c.b.clientId}/contacts/${c.b.contactId}`, body: () => ({ firstName: "Changed" }), expectError: "edit clients" },
  { name: "Add a client location", method: "POST", path: (c) => `/api/clients/${c.b.clientId}/locations`, body: () => ({ name: "Should Not Exist" }), expectError: "edit clients" },
  { name: "Edit a client location", method: "PATCH", path: (c) => `/api/clients/${c.b.clientId}/locations/${c.b.clientLocationId}`, body: () => ({ name: "Changed" }), expectError: "edit clients" },
  { name: "Client assets", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/assets`, expectError: "view inventory" },
  { name: "Onboard a client for inventory", method: "POST", path: (c) => `/api/clients/${c.b.clientId}/onboard-inventory`, body: () => ({ prefix: "NOPE" }), expectError: "onboard clients for inventory" },
  { name: "Set a site's default container", method: "PATCH", path: (c) => `/api/client-locations/${c.b.clientLocationId}/default-container`, body: (c) => ({ containerId: c.fx.containerId }), expectError: "edit inventory" },

  // Catalog
  { name: "Create a catalog item", method: "POST", path: () => "/api/catalog", body: (c) => ({ name: "Should Not Exist", categoryId: c.b.categoryId }), expectError: "edit the catalog" },
  { name: "Open a catalog item", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}`, expectError: "view the catalog" },
  { name: "Edit a catalog item", method: "PATCH", path: (c) => `/api/catalog/${c.b.catalogItemId}`, body: (c) => ({ name: "Changed", categoryId: c.b.categoryId }), expectError: "edit the catalog" },
  { name: "Delete a catalog item", method: "DELETE", path: (c) => `/api/catalog/${c.b.catalogItemId}`, expectError: "delete catalog items", clerk: true },
  { name: "Catalog change log", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/change-log`, expectError: "view the catalog" },
  { name: "Catalog order history", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/order-history`, expectError: "view the catalog" },

  // Vendors
  { name: "Create a vendor", method: "POST", path: () => "/api/vendors", body: () => ({ name: "Should Not Exist" }), expectError: "edit vendors" },
  { name: "Open a vendor", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}`, expectError: "view vendors" },
  { name: "Edit a vendor", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}`, body: () => ({ name: "Changed" }), expectError: "edit vendors" },
  { name: "Vendor attachments", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/attachments`, expectError: "view vendors" },
  { name: "Upload a vendor attachment", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/attachments`, expectError: "edit vendors" },
  { name: "Delete a vendor attachment", method: "DELETE", path: (c) => `/api/vendors/${c.b.vendorId}/attachments/${c.b.vendorAttachmentId}`, expectError: "edit vendors" },
  { name: "Add a vendor contact", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/contacts`, body: () => ({ firstName: "Should", lastName: "Not Exist" }), expectError: "edit vendors" },
  { name: "Edit a vendor contact", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}/contacts/${c.b.vendorContactId}`, body: () => ({ firstName: "Changed" }), expectError: "edit vendors" },
  { name: "Add a vendor location", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/locations`, body: () => ({ name: "Should Not Exist" }), expectError: "edit vendors" },
  { name: "Edit a vendor location", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}/locations/${c.b.vendorLocationId}`, body: () => ({ name: "Changed" }), expectError: "edit vendors" },
  { name: "Upload a vendor logo", method: "POST", path: (c) => `/api/vendors/${c.b.vendorId}/logo`, expectError: "edit vendors" },
  { name: "Remove a vendor logo", method: "DELETE", path: (c) => `/api/vendors/${c.b.vendorId}/logo`, expectError: "edit vendors" },
  { name: "Vendor purchase orders", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/purchase-orders`, expectError: "view vendors" },

  // Categories, industries, contact tags, custom fields (Company settings)
  { name: "Create a category", method: "POST", path: () => "/api/categories", body: () => ({ name: "Should Not Exist" }), expectError: "manage company settings", clerk: true },
  { name: "Edit a category", method: "PATCH", path: (c) => `/api/categories/${c.b.categoryId}`, body: () => ({ name: "Changed" }), expectError: "manage company settings", clerk: true },
  { name: "Delete a category", method: "DELETE", path: (c) => `/api/categories/${c.b.categoryId}`, expectError: "manage company settings", clerk: true },
  { name: "A category's custom fields", method: "GET", path: (c) => `/api/categories/${c.b.categoryId}/custom-fields`, expectError: "manage company settings", clerk: true },
  { name: "Add a custom field", method: "POST", path: (c) => `/api/categories/${c.b.categoryId}/custom-fields`, body: () => ({ name: "Should Not Exist" }), expectError: "manage company settings", clerk: true },
  { name: "Edit a custom field", method: "PATCH", path: (c) => `/api/inventory-custom-fields/${c.b.customFieldId}`, body: () => ({ name: "Changed" }), expectError: "manage company settings", clerk: true },
  { name: "Delete a custom field", method: "DELETE", path: (c) => `/api/inventory-custom-fields/${c.b.customFieldId}`, expectError: "manage company settings", clerk: true },
  { name: "Add an industry", method: "POST", path: () => "/api/industries", body: () => ({ name: "Should Not Exist" }), expectError: "add industries" },
  { name: "Delete an industry", method: "DELETE", path: (c) => `/api/industries/${c.b.industryId}`, expectError: "manage company settings", clerk: true },
  { name: "Create a contact tag", method: "POST", path: () => "/api/contact-tags", body: () => ({ name: "Should Not Exist" }), expectError: "manage company settings", clerk: true },
  { name: "Edit a contact tag", method: "PATCH", path: (c) => `/api/contact-tags/${c.b.contactTagId}`, body: () => ({ name: "Changed" }), expectError: "manage company settings", clerk: true },
  { name: "Delete a contact tag", method: "DELETE", path: (c) => `/api/contact-tags/${c.b.contactTagId}`, expectError: "manage company settings", clerk: true },

  // Inventory
  { name: "List inventory assets", method: "GET", path: () => "/api/inventory-assets", expectError: "view inventory" },
  { name: "Add an inventory asset", method: "POST", path: () => "/api/inventory-assets", body: (c) => ({ catalogItemId: c.b.catalogItemId, serialNumber: "SHOULD-NOT-EXIST" }), expectError: "edit inventory" },
  { name: "Open an inventory asset", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}`, expectError: "view inventory" },
  { name: "Edit an inventory asset", method: "PATCH", path: (c) => `/api/inventory-assets/${c.b.assetId}`, body: () => ({ notes: "Changed" }), expectError: "edit inventory" },
  { name: "Delete an inventory asset", method: "DELETE", path: (c) => `/api/inventory-assets/${c.b.assetId}`, expectError: "delete inventory assets", clerk: true },
  { name: "Asset attachments", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments`, expectError: "view inventory" },
  { name: "Upload an asset attachment", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments`, expectError: "edit inventory" },
  { name: "Delete an asset attachment", method: "DELETE", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments/${c.b.assetAttachmentId}`, expectError: "edit inventory" },
  { name: "Check out an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/checkout`, body: (c) => ({ status: "INTERNAL", assignedUserId: c.b.adminId }), expectError: "edit inventory" },
  { name: "Return an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/return`, body: () => ({}), expectError: "edit inventory" },
  { name: "Redeploy an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/redeploy`, body: () => ({}), expectError: "edit inventory" },
  { name: "Offboard an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/offboard`, body: () => ({}), expectError: "edit inventory" },
  { name: "Remove an asset", method: "POST", path: (c) => `/api/inventory-assets/${c.b.assetId}/remove`, body: () => ({ reason: "LOST" }), expectError: "remove inventory assets", clerk: true },
  { name: "A site's containers", method: "GET", path: (c) => `/api/inventory-locations?clientLocationId=${c.b.clientLocationId}`, expectError: "view inventory" },
  { name: "Add a container", method: "POST", path: () => "/api/inventory-locations", body: (c) => ({ clientLocationId: c.b.clientLocationId, name: "Should Not Exist" }), expectError: "edit inventory" },
  { name: "Rename a container", method: "PATCH", path: (c) => `/api/inventory-locations/${c.fx.containerId}`, body: () => ({ name: "Changed" }), expectError: "edit inventory" },
  { name: "Delete a container", method: "DELETE", path: (c) => `/api/inventory-locations/${c.fx.containerId}`, expectError: "edit inventory" },
  { name: "Own company containers", method: "GET", path: () => "/api/inventory-locations/own-company", expectError: "view inventory" },
  { name: "List inventory stock", method: "GET", path: () => "/api/inventory-stock", expectError: "view inventory" },
  { name: "Add inventory stock", method: "POST", path: () => "/api/inventory-stock", body: (c) => ({ catalogItemId: c.fx.stockItemId, clientLocationId: c.b.clientLocationId, locationId: c.fx.containerId, quantity: 1 }), expectError: "edit inventory" },
  { name: "Adjust inventory stock", method: "PATCH", path: (c) => `/api/inventory-stock/${c.fx.stockId}/adjust`, body: () => ({ delta: 1 }), expectError: "edit inventory" },
  { name: "Delete inventory stock", method: "DELETE", path: (c) => `/api/inventory-stock/${c.fx.stockId}`, expectError: "delete inventory stock", clerk: true },
]

const refusedFor =
  (actor: Actor) =>
  (g: Guarded): Attempt => ({ ...g, actor, kind: "refused", expect: 403 })

// Picker routes other pages' forms read, open to any active user
const PICKERS: { name: string; path: string; contains: (c: AttemptContext) => string[] }[] = [
  { name: "Client picker", path: "/api/clients", contains: (c) => [c.b.clientId] },
  { name: "Client detail picker", path: "/api/clients/CLIENT", contains: (c) => [c.b.clientId, c.b.contactId] },
  { name: "Contact search", path: "/api/contacts/search?q=Sample", contains: (c) => [c.b.contactId] },
  { name: "Category picker", path: "/api/categories", contains: (c) => [c.b.categoryId] },
  { name: "Industry picker", path: "/api/industries", contains: (c) => [c.b.industryId] },
  { name: "Contact tag picker", path: "/api/contact-tags", contains: (c) => [c.b.contactTagId] },
  { name: "Custom field list", path: "/api/inventory-custom-fields", contains: (c) => [c.b.customFieldId] },
  { name: "Vendor picker", path: "/api/vendors", contains: (c) => [c.b.vendorId] },
]

const pickerFor =
  (actor: Actor) =>
  (p: (typeof PICKERS)[number]): Attempt => ({
    name: p.name,
    actor,
    kind: "allowed",
    method: "GET",
    path: (c) => p.path.replace("CLIENT", c.b.clientId),
    expect: 200,
    contains: p.contains,
  })

// The catalog picker list, with cost only for users who can see it
const catalogList = (actor: Actor, kind: Attempt["kind"], withCost: boolean): Attempt => ({
  name: withCost ? "Catalog picker list, with cost" : "Catalog picker list, without cost",
  actor,
  kind,
  method: "GET",
  path: () => "/api/catalog",
  expect: 200,
  contains: (c) => (withCost ? [c.b.catalogItemId, '"cost"'] : [c.b.catalogItemId]),
  notContains: () => (withCost ? [] : ['"cost"']),
})

// Distributor offers carry no dealer price or cost for users who can't see cost
function offersWithoutPricing(json: unknown): string | null {
  const products = (json as { products?: { offers?: Record<string, unknown>[] }[] }).products
  if (!Array.isArray(products)) return "no products list in the response"
  const priced = products.flatMap((p) => p.offers ?? []).filter((o) => "price" in o || "cost" in o)
  return priced.length > 0 ? `${priced.length} offers still include price or cost` : null
}

// Every sales order and purchase order route, and the SO/PO settings read.
// Test Everyone B, Test Rep B, and Test Clerk B hold neither order page, so
// each one is refused for all three with a 403 before any record is looked
// up. The ids are Test Admin B's records.
const ORDER_GUARDED: Guarded[] = [
  { name: "List sales orders", method: "GET", path: () => "/api/sales-orders", expectError: "view sales orders" },
  { name: "Create a sales order", method: "POST", path: () => "/api/sales-orders", body: (c) => ({ clientId: c.b.clientId }), expectError: "create sales orders" },
  { name: "Open a sales order", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expectError: "view sales orders" },
  { name: "Edit a sales order", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, body: () => ({ internalNotes: "Changed" }), expectError: "edit sales orders" },
  { name: "Change a sales order's status", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, body: () => ({ status: "CLOSED" }), expectError: "edit sales orders" },
  { name: "Delete a sales order", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expectError: "delete sales orders" },
  { name: "Sales order attachments", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments`, expectError: "view sales orders" },
  { name: "Upload a sales order attachment", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments`, expectError: "edit sales orders" },
  { name: "Delete a sales order attachment", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments/${c.b.soAttachmentId}`, expectError: "edit sales orders" },
  { name: "Sales order comments", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, expectError: "view sales orders" },
  { name: "Comment on a sales order", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, body: () => ({ message: "Should not exist" }), expectError: "view sales orders" },
  { name: "Add a sales order line item", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expectError: "edit sales orders" },
  { name: "Edit a sales order line item", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, body: () => ({ name: "Changed" }), expectError: "edit sales orders" },
  { name: "Delete a sales order line item", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, expectError: "edit sales orders" },
  { name: "Sales order and purchase order settings", method: "GET", path: () => "/api/so-po-settings", expectError: "sales order and purchase order settings" },
  { name: "List purchase orders", method: "GET", path: () => "/api/purchase-orders", expectError: "view purchase orders" },
  { name: "Create a purchase order", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId }), expectError: "create purchase orders" },
  { name: "Generate a purchase order from sales order lines", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.b.salesOrderId, soLineItemIds: [c.b.soLineId] }), expectError: "create purchase orders" },
  { name: "Open a purchase order", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, expectError: "view purchase orders" },
  { name: "Edit a purchase order", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, body: () => ({ internalNotes: "Changed" }), expectError: "edit purchase orders" },
  { name: "Change a purchase order's status", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, body: () => ({ status: "CANCELLED" }), expectError: "edit purchase orders" },
  { name: "Delete a purchase order", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, expectError: "delete purchase orders" },
  { name: "Purchase order attachments", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments`, expectError: "view purchase orders" },
  { name: "Upload a purchase order attachment", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments`, expectError: "edit purchase orders" },
  { name: "Delete a purchase order attachment", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments/${c.b.poAttachmentId}`, expectError: "edit purchase orders" },
  { name: "Purchase order comments", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/comments`, expectError: "view purchase orders" },
  { name: "Comment on a purchase order", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/comments`, body: () => ({ message: "Should not exist" }), expectError: "view purchase orders" },
  { name: "Add a purchase order line item", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expectError: "edit purchase orders" },
  { name: "Edit a purchase order line item", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ name: "Changed", received: true }), expectError: "edit purchase orders" },
  { name: "Delete a purchase order line item", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, expectError: "edit purchase orders" },
  { name: "Receive a purchase order line item", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}/receive`, body: () => ({}), expectError: "edit purchase orders" },
]

// Settings, users, and roles routes Test Everyone B is refused. The
// distributor connection test is left out on purpose: a broken refusal
// there could call a real distributor.
const SETTINGS_GUARDED: Guarded[] = [
  { name: "Notification settings", method: "GET", path: () => "/api/notification-settings", expectError: "notification settings" },
  { name: "Save notification settings", method: "PATCH", path: () => "/api/notification-settings", body: () => ({ emailDefaultCc: "nobody@example.test" }), expectError: "notification settings" },
  { name: "Approval workflows", method: "GET", path: () => "/api/approval-workflows", expectError: "approval workflows" },
  { name: "Create an approval workflow", method: "POST", path: () => "/api/approval-workflows", body: (c) => ({ name: "Should Not Exist", triggerType: "TOTAL_THRESHOLD", thresholdValue: 1, requiredRoleId: c.b.globalAdminRoleId }), expectError: "create approval workflows" },
  { name: "Edit an approval workflow", method: "PATCH", path: (c) => `/api/approval-workflows/${c.b.workflowId}`, body: () => ({ name: "Changed" }), expectError: "edit approval workflows" },
  { name: "Delete an approval workflow", method: "DELETE", path: (c) => `/api/approval-workflows/${c.b.workflowId}`, expectError: "delete approval workflows" },
  { name: "Distributor settings", method: "GET", path: () => "/api/distributor-settings", expectError: "view distributor settings" },
  { name: "Change distributor settings", method: "PATCH", path: () => "/api/distributor-settings/INGRAM_MICRO", body: () => ({ enabled: true }), expectError: "change distributor settings" },
  { name: "Edit company settings", method: "PATCH", path: () => "/api/company-settings", body: () => ({ name: "Changed" }), expectError: "edit company settings" },
  { name: "Upload a company logo", method: "POST", path: () => "/api/company-settings/logo", expectError: "change the company logo" },
  { name: "Remove the company logo", method: "DELETE", path: () => "/api/company-settings/logo?slot=primary", expectError: "change the company logo" },
  { name: "Remove the secondary company logo", method: "DELETE", path: () => "/api/company-settings/logo?slot=secondary", expectError: "change the company logo" },
  { name: "Company appearance", method: "GET", path: () => "/api/company-settings/appearance", expectError: "edit company settings" },
  { name: "Save company appearance", method: "PATCH", path: () => "/api/company-settings/appearance", body: () => ({ themeAccent: "#DC2626", allowUserTheme: false }), expectError: "edit company settings" },
  { name: "Company sidebar", method: "GET", path: () => "/api/company-settings/sidebar", expectError: "edit company settings" },
  { name: "Save company sidebar", method: "PATCH", path: () => "/api/company-settings/sidebar", body: () => ({ allowUserSidebar: false, layout: { defaultViews: { tickets: "all" } } }), expectError: "edit company settings" },
  { name: "Reset company sidebar", method: "DELETE", path: () => "/api/company-settings/sidebar", expectError: "edit company settings" },
  { name: "Change Microsoft settings", method: "PATCH", path: () => "/api/microsoft-settings", body: () => ({ microsoftTenantId: "00000000-0000-0000-0000-000000000000" }), expectError: "configure Microsoft integration" },
  { name: "Edit quote settings", method: "PATCH", path: () => "/api/quote-settings", body: () => ({ quotePrefix: "NOPE" }), expectError: "edit quote settings" },
  { name: "Invite a user", method: "POST", path: () => "/api/users", body: () => ({ name: "Should Not Exist", email: "should-not-exist@example.test", tempPassword: "ShouldNotExist123" }), expectError: "invite users" },
  { name: "Edit a user", method: "PATCH", path: (c) => `/api/users/${c.b.adminId}`, body: () => ({ name: "Changed" }), expectError: "edit users" },
  { name: "Unlock a user", method: "POST", path: (c) => `/api/users/${c.b.adminId}/unlock`, expectError: "Only a Global Admin" },
  { name: "Create a role", method: "POST", path: () => "/api/roles", body: () => ({ name: "Should Not Exist" }), expectError: "create roles" },
  { name: "Edit a role", method: "PATCH", path: (c) => `/api/roles/${c.fx.repRoleId}`, body: () => ({ name: "Changed" }), expectError: "edit roles" },
  { name: "Delete a role", method: "DELETE", path: (c) => `/api/roles/${c.fx.repRoleId}`, expectError: "delete roles" },
  { name: "Reorder roles", method: "PUT", path: () => "/api/roles/order", body: (c) => ({ roleIds: [c.fx.repRoleId, c.fx.clerkRoleId] }), expectError: "reorder roles" },
]

// Every opportunity, attachment, stage, type, and settings route. Test
// Everyone B holds none of the opportunity keys, so each one is refused
// with a 403 before any record is looked up. The "manage opportunity
// settings" ones (stage, type, and settings writes) are also refused for
// Test Rep B and Test Opp Viewer B, who don't hold settingsSections.opportunities.
// The ids are the unassigned sample opportunity's and the company's first
// stage and type.
const OPP_SETTINGS_WRITE = "manage opportunity settings"

// Creating an opportunity needs an initial note, so each create attempt
// sends one and is still refused (or allowed) for the reason under test
const OPP_NOTE = "<p>Dev check initial note</p>"
const OPP_GUARDED: Guarded[] = [
  { name: "List opportunities", method: "GET", path: () => "/api/opportunities", expectError: "view opportunities" },
  { name: "Create an opportunity", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expectError: "create opportunities" },
  { name: "Open an opportunity", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expectError: "view opportunities" },
  { name: "Edit an opportunity", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, body: () => ({ title: "Changed" }), expectError: "edit opportunities" },
  { name: "Delete an opportunity", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expectError: "delete opportunities" },
  { name: "Opportunity attachments", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expectError: "view opportunities" },
  { name: "Opportunity related records", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/related`, expectError: "view opportunities" },
  { name: "Opportunity timeline", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, expectError: "view opportunities" },
  { name: "Add an opportunity note", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>" }), expectError: "edit opportunities" },
  { name: "Edit an opportunity note", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expectError: "edit opportunities" },
  { name: "Delete an opportunity note", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, expectError: "edit opportunities" },
  { name: "Upload an opportunity attachment", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expectError: "edit opportunities" },
  { name: "Delete an opportunity attachment", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments/${c.fx.unassignedOpportunityAttachmentId}`, expectError: "edit opportunities" },
  { name: "Opportunity stages", method: "GET", path: () => "/api/opportunity-stages", expectError: "view opportunity stages" },
  { name: "Add an opportunity stage", method: "POST", path: () => "/api/opportunity-stages", body: () => ({ name: "Should Not Exist", category: "OPEN" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Edit an opportunity stage", method: "PATCH", path: (c) => `/api/opportunity-stages/${c.b.opportunityStageId}`, body: () => ({ name: "Changed" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Delete an opportunity stage", method: "DELETE", path: (c) => `/api/opportunity-stages/${c.b.opportunityStageId}`, expectError: OPP_SETTINGS_WRITE },
  { name: "Reorder opportunity stages", method: "POST", path: () => "/api/opportunity-stages/reorder", body: (c) => ({ stageIds: [...c.fx.opportunityStageIds].reverse() }), expectError: OPP_SETTINGS_WRITE },
  { name: "Opportunity types", method: "GET", path: () => "/api/opportunity-types", expectError: "view opportunity types" },
  { name: "Add an opportunity type", method: "POST", path: () => "/api/opportunity-types", body: () => ({ name: "Should Not Exist" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Edit an opportunity type", method: "PATCH", path: (c) => `/api/opportunity-types/${c.b.opportunityTypeId}`, body: () => ({ name: "Changed" }), expectError: OPP_SETTINGS_WRITE },
  { name: "Delete an opportunity type", method: "DELETE", path: (c) => `/api/opportunity-types/${c.b.opportunityTypeId}`, expectError: OPP_SETTINGS_WRITE },
  { name: "Reorder opportunity types", method: "POST", path: () => "/api/opportunity-types/reorder", body: (c) => ({ typeIds: [...c.fx.opportunityTypeIds].reverse() }), expectError: OPP_SETTINGS_WRITE },
  { name: "Opportunity settings", method: "GET", path: () => "/api/opportunity-settings", expectError: "view opportunity settings" },
  { name: "Edit opportunity settings", method: "PATCH", path: () => "/api/opportunity-settings", body: () => ({ prefix: "NOPE" }), expectError: OPP_SETTINGS_WRITE },
]

const ACTION_BUTTON_WRITE = "manage action buttons"
// A complete, valid button, so a create can only be refused for the reason
// under test
const buttonBody = (extra: Record<string, unknown> = {}) => ({
  label: "Should Not Exist",
  icon: "note",
  color: "#1B3A5C",
  forOpportunities: true,
  forTickets: false,
  kind: "NOTE",
  stageMode: "NONE",
  fixedStageId: null,
  noteMode: "REQUIRED",
  isHidden: false,
  ...extra,
})
const ACTION_BUTTON_GUARDED: Guarded[] = [
  { name: "All action buttons", method: "GET", path: () => "/api/action-buttons", expectError: ACTION_BUTTON_WRITE },
  { name: "Add an action button", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody(), expectError: ACTION_BUTTON_WRITE },
  { name: "Edit an action button", method: "PATCH", path: (c) => `/api/action-buttons/${c.b.actionButtonId}`, body: () => ({ label: "Changed" }), expectError: ACTION_BUTTON_WRITE },
  { name: "Delete an action button", method: "DELETE", path: (c) => `/api/action-buttons/${c.b.actionButtonId}`, expectError: ACTION_BUTTON_WRITE },
  { name: "Reorder action buttons", method: "POST", path: () => "/api/action-buttons/reorder", body: (c) => ({ buttonIds: [...c.fx.actionButtonIds].reverse() }), expectError: ACTION_BUTTON_WRITE },
]

// A complete email, so an email attempt can only be refused for the reason
// under test. Never sent: every attempt below is refused before sending.
const emailBody = (extra: Record<string, unknown> = {}) => ({
  to: ["nobody@example.test"],
  subject: "Dev only check, never sent",
  body: "<p>Dev only check, never sent</p>",
  ...extra,
})

// A created opportunity must belong to the expected owner (null for
// unassigned). It is removed again once checked.
function createdOpportunityOwnedBy(ownerId: (c: AttemptContext) => string | null) {
  return async (json: unknown, c: AttemptContext, prisma: PrismaClient): Promise<string | null> => {
    const created = json as { id?: string; owner?: { id?: string } | null }
    if (!created.id) return "no opportunity id in the response"
    try {
      const expected = ownerId(c)
      return (created.owner?.id ?? null) === expected ? null : `the owner is ${created.owner?.id ?? "nobody"}, expected ${expected ?? "nobody"}`
    } finally {
      await prisma.opportunity.deleteMany({ where: { id: created.id } })
    }
  }
}

// Reads any active user may make, and what they must leave out
const activeReadsFor = (actor: Actor): Attempt[] => [
  { name: "Company settings (any signed in user)", actor, kind: "allowed", method: "GET", path: () => "/api/company-settings", expect: 200, contains: () => ["primaryColor"] },
  { name: "Microsoft settings, no secret", actor, kind: "allowed", method: "GET", path: () => "/api/microsoft-settings", expect: 200, contains: () => ["hasClientSecret"], notContains: () => ["microsoftClientSecret"] },
  { name: "Users list, no email addresses", actor, kind: "allowed", method: "GET", path: () => "/api/users", expect: 200, contains: (c) => [c.names.adminName], notContains: (c) => [c.names.adminEmail, '"email"'] },
  { name: "Roles list, no permissions", actor, kind: "allowed", method: "GET", path: () => "/api/roles", expect: 200, contains: (c) => [c.b.globalAdminRoleId], notContains: () => ['"permissions"'] },
  { name: "Enabled distributors", actor, kind: "allowed", method: "GET", path: () => "/api/distributors/enabled", expect: 200, contains: () => ["["] },
  { name: "Own distributor preferences", actor, kind: "allowed", method: "GET", path: () => "/api/distributor-search/preferences", expect: 200, contains: () => ["distributors"] },
  { name: "Save own distributor preferences", actor, kind: "allowed", method: "PATCH", path: () => "/api/distributor-search/preferences", body: () => ({ distributors: [] }), expect: 200, contains: () => ["distributors"] },
  { name: "Own notifications", actor, kind: "allowed", method: "GET", path: () => "/api/notifications", expect: 200, contains: () => ["unreadCount"] },
  { name: "Own dashboards", actor, kind: "allowed", method: "GET", path: () => "/api/dashboards", expect: 200, contains: () => ["isMyDefault"] },
]

// A widget the user may not see answers with no data, never an error
const noAccessWidget = (actor: Actor, type: string): Attempt => ({
  name: `${type} widget, no data`,
  actor,
  kind: "allowed",
  method: "GET",
  path: () => `/api/dashboards/widget-data?type=${type}`,
  expect: 200,
  contains: () => ['"noAccess":true'],
  notContains: () => ['"count"', '"groups"'],
})

// The created template line must hold the catalog item's stored cost, not
// the bogus one sent. The line is removed again once checked.
async function templateLineUsesCatalogCost(json: unknown, prisma: PrismaClient): Promise<string | null> {
  const created = json as { id?: string; cost?: unknown }
  if (!created.id) return "no line item id in the response"
  try {
    if ("cost" in created) return "the response includes cost for a user who can't see it"
    const row = await prisma.quoteTemplateLineItem.findUnique({ where: { id: created.id }, select: { cost: true } })
    if (!row) return "the created line item isn't in the database"
    return row.cost === SAMPLE_ITEM_COST ? null : `stored cost is ${row.cost}, the catalog cost is ${SAMPLE_ITEM_COST}`
  } finally {
    await prisma.quoteTemplateLineItem.deleteMany({ where: { id: created.id } })
  }
}

// The open purchase orders widget counts only the user's own
async function openPOsCountOwn(json: unknown, companyId: string, userId: string, prisma: PrismaClient) {
  const count = (json as { count?: number }).count
  const own = await prisma.purchaseOrder.count({
    where: { companyId, userId, status: { in: ["DRAFT", "PARTS_ORDERED", "ON_HOLD", "BACKORDERED"] } },
  })
  return count === own ? null : `count is ${count}, the user has ${own} open purchase orders`
}

// ─── Teams ───────────────────────────────────────────────────────────────────
// The fixtures (lib/run-data.ts): General holds Test Rep B and Test Opp
// Viewer B and the three original sample opportunities. Sales holds Test
// Team Basic B (no viewTeam) and Test Team Viewer B (viewTeam) and gives
// Team Grant; its opportunities are owned by the viewer, by the basic user,
// and unassigned. Support has no members and gives Team High, above Test
// Team Manager B (Teams only, rank 5).

const TEAM_WRITE = "manage teams"

interface SidebarJson {
  total: number
  teams: { id: string; count: number; unassigned: number; members: { id: string; count: number }[] }[]
}

// The sidebar counts as one user sees them: exactly these teams, and in
// the team checked, exactly these members and counts
function sidebarShows(expect: (c: AttemptContext) => { teamIds: string[]; team: string; members: string[]; count: number; unassigned: number }) {
  return (json: unknown, c: AttemptContext): string | null => {
    const counts = json as SidebarJson
    const e = expect(c)
    if (!Array.isArray(counts.teams)) return "no teams in the response"
    const ids = counts.teams.map((t) => t.id)
    if (ids.length !== e.teamIds.length || e.teamIds.some((id) => !ids.includes(id))) return `listed ${ids.length} teams, expected ${e.teamIds.length}`
    const team = counts.teams.find((t) => t.id === e.team)
    if (!team) return "the team checked is missing"
    const members = team.members.map((m) => m.id)
    if (members.length !== e.members.length || e.members.some((id) => !members.includes(id))) return `listed ${members.length} members, expected ${e.members.length}`
    if (team.count !== e.count) return `the team count is ${team.count}, expected ${e.count}`
    if (team.unassigned !== e.unassigned) return `the unassigned count is ${team.unassigned}, expected ${e.unassigned}`
    return null
  }
}

const TEAM_ATTEMPTS: Attempt[] = [
  // Visibility, basic: own anywhere, plus unassigned ones in its teams
  { name: "List opportunities: own and the team's unassigned", actor: "teamBasic", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.salesBasicOpportunityId, c.fx.salesUnassignedOpportunityId], notContains: (c) => [c.fx.salesViewerOpportunityId, c.fx.unassignedOpportunityId, c.b.opportunityId] },
  { name: "Open a teammate's opportunity", actor: "teamBasic", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesViewerOpportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Open the team's unassigned opportunity", actor: "teamBasic", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesUnassignedOpportunityId}`, expect: 200, contains: (c) => [c.b.salesTeamId] },
  { name: "Open another team's unassigned opportunity", actor: "teamBasic", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Timeline of a teammate's opportunity", actor: "teamBasic", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesViewerOpportunityId}/timeline`, expect: 404, expectError: "Not found" },
  { name: "Timeline of own opportunity", actor: "teamBasic", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesBasicOpportunityId}/timeline`, expect: 200, contains: () => ["entries"] },
  { name: "Related records of a teammate's opportunity", actor: "teamBasic", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesViewerOpportunityId}/related`, expect: 404, expectError: "Not found" },
  { name: "Related records of the team's unassigned opportunity", actor: "teamBasic", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesUnassignedOpportunityId}/related`, expect: 200, contains: () => ["quotes"] },
  // Visibility, viewTeam: every one in its teams, nothing outside them
  { name: "List opportunities: every one in its team", actor: "teamViewer", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.salesViewerOpportunityId, c.fx.salesBasicOpportunityId, c.fx.salesUnassignedOpportunityId], notContains: (c) => [c.fx.unassignedOpportunityId, c.b.opportunityId, c.fx.repOpportunityId] },
  { name: "Open a teammate's opportunity", actor: "teamViewer", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesBasicOpportunityId}`, expect: 200, contains: (c) => [c.fx.salesBasicOpportunityId] },
  { name: "Timeline of a teammate's opportunity", actor: "teamViewer", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesBasicOpportunityId}/timeline`, expect: 200, contains: () => ["entries"] },
  { name: "Related records of a teammate's opportunity", actor: "teamViewer", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.fx.salesBasicOpportunityId}/related`, expect: 200, contains: () => ["quotes"] },
  { name: "Open another team's unassigned opportunity", actor: "teamViewer", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Timeline of another team's opportunity", actor: "teamViewer", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/timeline`, expect: 404, expectError: "Not found" },
  // Visibility, viewAll (Global Admin): every team's
  { name: "List opportunities: every team's", actor: "admin", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.salesViewerOpportunityId, c.fx.salesBasicOpportunityId, c.fx.salesUnassignedOpportunityId, c.fx.unassignedOpportunityId, c.b.opportunityId] },
  { name: "List filtered to a team", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/opportunities?teamId=${c.b.salesTeamId}&ownerId=unassigned`, expect: 200, contains: (c) => [c.fx.salesUnassignedOpportunityId], notContains: (c) => [c.fx.salesViewerOpportunityId, c.fx.unassignedOpportunityId] },
  // Sidebar counts: only what each user can see
  { name: "Sidebar counts: own team, only itself", actor: "teamBasic", kind: "allowed", method: "GET", path: () => "/api/opportunities/sidebar-counts", expect: 200, check: sidebarShows((c) => ({ teamIds: [c.b.salesTeamId], team: c.b.salesTeamId, members: [c.fx.teamBasicUserId], count: 2, unassigned: 1 })) },
  { name: "Sidebar counts: own team, every member", actor: "teamViewer", kind: "allowed", method: "GET", path: () => "/api/opportunities/sidebar-counts", expect: 200, check: sidebarShows((c) => ({ teamIds: [c.b.salesTeamId], team: c.b.salesTeamId, members: [c.fx.teamBasicUserId, c.fx.teamViewerUserId], count: 3, unassigned: 1 })) },
  { name: "Sidebar counts: every team", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/opportunities/sidebar-counts", expect: 200, check: sidebarShows((c) => ({ teamIds: c.fx.teamIds, team: c.b.salesTeamId, members: [c.fx.teamBasicUserId, c.fx.teamViewerUserId], count: 3, unassigned: 1 })) },
  { name: "Sidebar counts", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/opportunities/sidebar-counts", expect: 403, expectError: "view opportunities" },
  { name: "Sidebar counts", actor: "oppSettings", kind: "refused", method: "GET", path: () => "/api/opportunities/sidebar-counts", expect: 403, expectError: "view opportunities" },
  // Owner rules
  { name: "Create for a teammate", actor: "teamBasic", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, teamId: c.b.salesTeamId, ownerId: c.fx.teamViewerUserId }), expect: 403, expectError: "yourself or leave them unassigned" },
  { name: "Create for itself in its team", actor: "teamBasic", kind: "allowed", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId, teamId: c.b.salesTeamId, ownerId: c.fx.teamBasicUserId }), expect: 200, check: createdOpportunityOwnedBy((c) => c.fx.teamBasicUserId) },
  { name: "Create for itself in General, which it isn't in", actor: "teamBasic", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: c.fx.teamBasicUserId }), expect: 400, expectError: "Owner is not in this team" },
  { name: "Create in a team it isn't in", actor: "teamBasic", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, teamId: c.fx.supportTeamId }), expect: 403, expectError: "teams you belong to" },
  { name: "Create unassigned in General", actor: "teamBasic", kind: "allowed", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 200, check: createdOpportunityOwnedBy(() => null) },
  { name: "Create for a teammate", actor: "teamViewer", kind: "allowed", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId, teamId: c.b.salesTeamId, ownerId: c.fx.teamBasicUserId }), expect: 200, check: createdOpportunityOwnedBy((c) => c.fx.teamBasicUserId) },
  { name: "Create for someone in a team it isn't in", actor: "teamViewer", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: c.repUserId }), expect: 403, expectError: "yourself or leave them unassigned" },
  { name: "Create for someone outside the team", actor: "admin", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, teamId: c.b.salesTeamId, ownerId: c.repUserId }), expect: 400, expectError: "Owner is not in this team" },
  { name: "Assign to someone outside the team", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.salesUnassignedOpportunityId}`, body: (c) => ({ ownerId: c.repUserId }), expect: 400, expectError: "Owner is not in this team" },
  { name: "Assign a teammate's opportunity to a teammate", actor: "teamBasic", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.salesUnassignedOpportunityId}`, body: (c) => ({ ownerId: c.fx.teamViewerUserId }), expect: 403, expectError: "yourself or leave them unassigned" },
  // Team changes
  { name: "Move to a team it isn't in", actor: "teamBasic", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.salesBasicOpportunityId}`, body: (c) => ({ teamId: c.b.generalTeamId, ownerId: null }), expect: 403, expectError: "teams you belong to" },
  { name: "Move to a team it isn't in", actor: "teamViewer", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.salesBasicOpportunityId}`, body: (c) => ({ teamId: c.fx.supportTeamId, ownerId: null }), expect: 403, expectError: "teams you belong to" },
  { name: "Move away from its owner's team, keeping the owner", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.salesViewerOpportunityId}`, body: (c) => ({ teamId: c.b.generalTeamId }), expect: 400, expectError: "not in the new team" },
  { name: "Clear the team", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.salesViewerOpportunityId}`, body: () => ({ teamId: null }), expect: 400, expectError: "A team is required" },
  // Teams routes: the new keys gate them
  { name: "List teams", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/teams", expect: 403, expectError: "view teams" },
  { name: "List teams without members", actor: "rep", kind: "allowed", method: "GET", path: () => "/api/teams", expect: 200, contains: (c) => [c.b.salesTeamId, "assignableOwnerIds"], notContains: () => ['"members"'] },
  { name: "List teams with members", actor: "teamManager", kind: "allowed", method: "GET", path: () => "/api/teams", expect: 200, contains: (c) => [c.b.salesTeamId, '"members"', c.fx.teamBasicUserId] },
  { name: "Reorder teams, same order", actor: "teamManager", kind: "allowed", method: "POST", path: () => "/api/teams/reorder", body: (c) => ({ teamIds: c.fx.teamIds }), expect: 200, contains: (c) => [c.b.salesTeamId] },
  { name: "Create a team", actor: "rep", kind: "refused", method: "POST", path: () => "/api/teams", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: TEAM_WRITE },
  { name: "Rename a team", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/teams/${c.b.salesTeamId}`, body: () => ({ name: "Changed" }), expect: 403, expectError: TEAM_WRITE },
  { name: "Delete a team", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/teams/${c.fx.supportTeamId}`, expect: 403, expectError: TEAM_WRITE },
  { name: "Reorder teams", actor: "rep", kind: "refused", method: "POST", path: () => "/api/teams/reorder", body: (c) => ({ teamIds: [...c.fx.teamIds].reverse() }), expect: 403, expectError: TEAM_WRITE },
  { name: "Replace team members", actor: "rep", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/members`, body: (c) => ({ userIds: [c.repUserId] }), expect: 403, expectError: TEAM_WRITE },
  { name: "Replace team default roles", actor: "rep", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/default-roles`, body: () => ({ roleIds: [] }), expect: 403, expectError: TEAM_WRITE },
  { name: "Change a user's teams", actor: "manager", kind: "refused", method: "PATCH", path: (c) => `/api/users/${c.fx.everyoneUserId}`, body: (c) => ({ teamIds: [c.b.salesTeamId] }), expect: 403, expectError: TEAM_WRITE },
  // The grant rule: a role out of Test Team Manager B's reach, directly or by adding a member
  { name: "Give a team a role above its rank", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/default-roles`, body: (c) => ({ roleIds: [c.b.teamGrantRoleId, c.fx.teamHighRoleId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Add a member to a team with a role above its rank", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.fx.supportTeamId}/members`, body: (c) => ({ userIds: [c.fx.teamBasicUserId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Create a team with a role above its rank", actor: "teamManager", kind: "refused", method: "POST", path: () => "/api/teams", body: (c) => ({ name: "Should Not Exist", defaultRoleIds: [c.fx.teamHighRoleId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Give a team Global Admin", actor: "admin", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/default-roles`, body: (c) => ({ roleIds: [c.b.globalAdminRoleId] }), expect: 400, expectError: "Global Admin" },
  { name: "Give a team the Everyone role", actor: "admin", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/default-roles`, body: (c) => ({ roleIds: [c.b.everyoneRoleId] }), expect: 400, expectError: "Everyone" },
  // Deletes that are blocked
  { name: "Delete General", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/teams/${c.b.generalTeamId}`, expect: 409, expectError: "can't be deleted" },
  { name: "Delete a team in use", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/teams/${c.b.salesTeamId}`, expect: 409, expectError: "This team has 3 opportunities" },
  // The grant rule: a role below its rank that grants a permission it lacks
  { name: "Attach a role with a permission it lacks", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.fx.opsTeamId}/default-roles`, body: (c) => ({ roleIds: [c.fx.teamLiteRoleId, c.b.teamGrantRoleId] }), expect: 403, expectError: "includes permissions you don't have" },
  { name: "Create a team with a role with a permission it lacks", actor: "teamManager", kind: "refused", method: "POST", path: () => "/api/teams", body: (c) => ({ name: "Should Not Exist", defaultRoleIds: [c.b.teamGrantRoleId] }), expect: 403, expectError: "includes permissions you don't have" },
  { name: "Add itself to a team giving a role with a permission it lacks", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/members`, body: (c) => ({ userIds: [c.fx.teamBasicUserId, c.fx.teamViewerUserId, c.fx.teamManagerUserId] }), expect: 403, expectError: "includes permissions you don't have" },
  { name: "Add anyone to a team giving a role with a permission it lacks", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.b.salesTeamId}/members`, body: (c) => ({ userIds: [c.fx.teamBasicUserId, c.fx.teamViewerUserId, c.fx.oppViewerUserId] }), expect: 403, expectError: "includes permissions you don't have" },
  { name: "Give a role with a permission it lacks", actor: "manager", kind: "refused", method: "PATCH", path: (c) => `/api/users/${c.fx.everyoneUserId}`, body: (c) => ({ roleIds: [c.b.teamGrantRoleId] }), expect: 403, expectError: "includes permissions you don't have" },
  { name: "Invite into a role with a permission it lacks", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: "should-not-exist-grant@example.test", tempPassword: "ShouldNotExist123", roleIds: [c.b.teamGrantRoleId] }), expect: 403, expectError: "includes permissions you don't have" },
  // The membership rank rule
  { name: "Add a member at its own rank", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.fx.opsTeamId}/members`, body: (c) => ({ userIds: [c.b.adminId, c.fx.teamManagerUserId, c.repUserId] }), expect: 403, expectError: "ranked below you" },
  { name: "Remove a member ranked above it", actor: "teamManager", kind: "refused", method: "PUT", path: (c) => `/api/teams/${c.fx.opsTeamId}/members`, body: (c) => ({ userIds: [c.fx.teamManagerUserId] }), expect: 403, expectError: "ranked below you" },
  { name: "Rename to another team's name", actor: "teamManager", kind: "refused", method: "PATCH", path: (c) => `/api/teams/${c.fx.supportTeamId}`, body: (c) => ({ name: c.names.salesTeam }), expect: 400, expectError: "already exists" },
]

// ─── AUDIT LOG ───────────────────────────────────────────────────────────────
// The audit routes need auditLog.view (the lists) and auditLog.restore (undo
// and restore). Test Audit Viewer B (made by this script) holds view but not
// restore. Undo and restore that succeed are checked in checkAuditUndo and
// checkSoftDelete on an opportunity the script creates.

const AUDIT_VIEW = "view the audit log"
const AUDIT_RESTORE = "restore from the audit log"

const AUDIT_ATTEMPTS: Attempt[] = [
  { name: "Read the audit log", actor: "admin", kind: "control", method: "GET", path: () => "/api/audit-log", expect: 200, contains: (c) => [c.b.auditEntryId] },
  { name: "Read the audit log", actor: "auditViewer", kind: "allowed", method: "GET", path: () => "/api/audit-log", expect: 200, contains: (c) => [c.b.auditEntryId] },
  { name: "Read an opportunity's audit log", actor: "auditViewer", kind: "allowed", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/audit`, expect: 200, contains: (c) => [c.b.auditEntryId] },
  { name: "Undo a change", actor: "auditViewer", kind: "refused", method: "POST", path: (c) => `/api/audit-log/${c.b.auditEntryId}/undo`, expect: 403, expectError: AUDIT_RESTORE },
  { name: "Restore an opportunity", actor: "auditViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.b.opportunityId}/restore`, expect: 403, expectError: AUDIT_RESTORE },
  { name: "Read the audit log", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/audit-log", expect: 403, expectError: AUDIT_VIEW },
  { name: "Read the audit log", actor: "oppViewer", kind: "refused", method: "GET", path: () => "/api/audit-log", expect: 403, expectError: AUDIT_VIEW },
  { name: "Read the audit log", actor: "oppSettings", kind: "refused", method: "GET", path: () => "/api/audit-log", expect: 403, expectError: AUDIT_VIEW },
  { name: "Read the audit log", actor: "manager", kind: "refused", method: "GET", path: () => "/api/audit-log", expect: 403, expectError: AUDIT_VIEW },
  { name: "Read an opportunity's audit log", actor: "oppViewer", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/audit`, expect: 403, expectError: AUDIT_VIEW },
  { name: "Undo a change", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/audit-log/${c.b.auditEntryId}/undo`, expect: 403, expectError: AUDIT_RESTORE },
  { name: "Undo a change", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/audit-log/${c.b.auditEntryId}/undo`, expect: 403, expectError: AUDIT_RESTORE },
  { name: "Restore an opportunity", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/restore`, expect: 403, expectError: AUDIT_RESTORE },
  { name: "Restore an opportunity that isn't deleted", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.b.opportunityId}/restore`, expect: 409, expectError: "isn't deleted" },
  { name: "Undo a made up entry", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/audit-log/${c.fakeId}/undo`, expect: 404, expectError: "Not found" },
  { name: "Audit log of a made up record type", actor: "admin", kind: "refused", method: "GET", path: () => "/api/audit-log?recordType=NOPE", expect: 400, expectError: "Invalid record type" },
  { name: "Audit log with a broken date", actor: "admin", kind: "refused", method: "GET", path: () => "/api/audit-log?from=not-a-date", expect: 400, expectError: "date range" },
  { name: "Audit log paged with a made up cursor", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/audit-log?cursor=${c.fakeId}`, expect: 400, expectError: "Invalid cursor" },
  { name: "Opportunity audit log paged with another opportunity's entry", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/audit?cursor=${c.b.auditEntryId}`, expect: 400, expectError: "Invalid cursor" },
]

// ─── TICKETS ─────────────────────────────────────────────────────────────────
// The ticket routes need pages.tickets (reads), tickets.create, tickets.edit
// (fields, notes, attachments, email), tickets.delete, and
// settingsSections.tickets (types, priorities, statuses, settings). The
// visibility levels: Test Ticket Basic B (basic: its own and the unassigned
// ones in its teams), Test Ticket Viewer B (tickets.viewTeam: every one in
// its teams), and Test Admin B (Global Admin: every one). Test Ticket
// Dispatcher B holds tickets.assign (assign anyone in the team, move to any
// team) and tickets.delete; Test Ticket Settings B holds only Ticket
// Settings and the Settings page. Created tickets are removed once checked.
// The steps after the list (checkTicketRoundRobin,
// checkTicketStatusTimestamps, checkTicketAuditFlow, checkTicketAutoClose)
// put back everything they change.

const TICKET_NOTE = "<p>Dev check ticket note</p>"
const TICKET_WRITE = "manage ticket settings"
const ticketBody = (c: AttemptContext, extra: Record<string, unknown> = {}) => ({
  initialNote: TICKET_NOTE,
  title: "Dev check ticket",
  clientId: c.b.clientId,
  contactId: c.b.contactId,
  ...extra,
})

// A created ticket must be assigned as expected (null for unassigned). It
// is removed again once checked.
function createdTicketAssignedTo(assigneeId: (c: AttemptContext) => string | null) {
  return async (json: unknown, c: AttemptContext, prisma: PrismaClient): Promise<string | null> => {
    const created = json as { id?: string; assignee?: { id?: string } | null; number?: string }
    if (!created.id) return "no ticket id in the response"
    try {
      const expected = assigneeId(c)
      if (!created.number || !/^T-\d{4}-\d{4,}$/.test(created.number)) return `the number is ${created.number ?? "missing"}, not T-YYYY-NNNN`
      return (created.assignee?.id ?? null) === expected ? null : `assigned to ${created.assignee?.id ?? "nobody"}, expected ${expected ?? "nobody"}`
    } finally {
      await prisma.ticket.deleteMany({ where: { id: created.id } })
    }
  }
}

const TICKET_ATTEMPTS: Attempt[] = [
  // Sidebar counts first, before anything else adds a ticket
  { name: "Ticket sidebar counts: own team, only itself", actor: "ticketBasic", kind: "allowed", method: "GET", path: () => "/api/tickets/sidebar-counts", expect: 200, check: sidebarShows((c) => ({ teamIds: [c.b.helpdeskTeamId, c.fx.roundRobinTeamId], team: c.b.helpdeskTeamId, members: [c.fx.ticketBasicUserId], count: 2, unassigned: 1 })) },
  { name: "Ticket sidebar counts: own team, every member", actor: "ticketViewer", kind: "allowed", method: "GET", path: () => "/api/tickets/sidebar-counts", expect: 200, check: sidebarShows((c) => ({ teamIds: [c.b.helpdeskTeamId, c.fx.roundRobinTeamId], team: c.b.helpdeskTeamId, members: [c.fx.ticketBasicUserId, c.fx.ticketViewerUserId, c.fx.ticketDispatcherUserId], count: 3, unassigned: 1 })) },
  { name: "Ticket sidebar counts: every team", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets/sidebar-counts", expect: 200, check: sidebarShows((c) => ({ teamIds: c.fx.teamIds, team: c.b.helpdeskTeamId, members: [c.fx.ticketBasicUserId, c.fx.ticketViewerUserId, c.fx.ticketDispatcherUserId], count: 3, unassigned: 1 })) },
  { name: "Ticket sidebar counts", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/tickets/sidebar-counts", expect: 403, expectError: "view tickets" },

  // Visibility, basic: its own anywhere, plus the unassigned ones in its teams
  { name: "List tickets: every one", actor: "admin", kind: "control", method: "GET", path: () => "/api/tickets", expect: 200, contains: (c) => [c.fx.basicTicketId, c.fx.viewerTicketId, c.b.ticketId, c.fx.alertsTicketId] },
  { name: "List tickets: own and the team's unassigned", actor: "ticketBasic", kind: "allowed", method: "GET", path: () => "/api/tickets", expect: 200, contains: (c) => [c.fx.basicTicketId, c.b.ticketId], notContains: (c) => [c.fx.viewerTicketId, c.fx.alertsTicketId] },
  { name: "Open a teammate's ticket", actor: "ticketBasic", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.viewerTicketId}`, expect: 404, expectError: "Not found" },
  { name: "Open the team's unassigned ticket", actor: "ticketBasic", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.b.ticketId}`, expect: 200, contains: (c) => [c.b.ticketId, c.b.helpdeskTeamId] },
  { name: "Open another team's unassigned ticket", actor: "ticketBasic", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.alertsTicketId}`, expect: 404, expectError: "Not found" },
  { name: "Timeline of a teammate's ticket", actor: "ticketBasic", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.viewerTicketId}/timeline`, expect: 404, expectError: "Not found" },
  { name: "Attachments of a teammate's ticket", actor: "ticketBasic", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.viewerTicketId}/attachments`, expect: 404, expectError: "Not found" },
  { name: "Email options of a teammate's ticket", actor: "ticketBasic", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.viewerTicketId}/email-options`, expect: 404, expectError: "Not found" },
  { name: "Timeline of own ticket", actor: "ticketBasic", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.fx.basicTicketId}/timeline`, expect: 200, contains: () => ["entries"] },
  // Visibility, viewTeam: every one in its teams, nothing outside them
  { name: "List tickets: every one in its team", actor: "ticketViewer", kind: "allowed", method: "GET", path: () => "/api/tickets", expect: 200, contains: (c) => [c.fx.basicTicketId, c.fx.viewerTicketId, c.b.ticketId], notContains: (c) => [c.fx.alertsTicketId] },
  { name: "Open a teammate's ticket", actor: "ticketViewer", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.fx.basicTicketId}`, expect: 200, contains: (c) => [c.fx.basicTicketId] },
  { name: "Timeline of a teammate's ticket", actor: "ticketViewer", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.fx.basicTicketId}/timeline`, expect: 200, contains: () => ["entries"] },
  { name: "Attachments of a teammate's ticket", actor: "ticketViewer", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.fx.basicTicketId}/attachments`, expect: 200, contains: () => ["downloadUrl"] },
  { name: "Open another team's ticket", actor: "ticketViewer", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.alertsTicketId}`, expect: 404, expectError: "Not found" },
  // Visibility, viewAll (Global Admin)
  { name: "Open another team's ticket", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.fx.alertsTicketId}`, expect: 200, contains: (c) => [c.fx.alertsTicketId] },
  { name: "List tickets filtered to a team's unassigned", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/tickets?teamId=${c.b.helpdeskTeamId}&assigneeId=unassigned`, expect: 200, contains: (c) => [c.b.ticketId], notContains: (c) => [c.fx.basicTicketId, c.fx.alertsTicketId] },
  { name: "List tickets filtered to closed ones", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets?statusCategory=CLOSED", expect: 200, notContains: (c) => [c.b.ticketId, c.fx.basicTicketId] },
  { name: "List tickets filtered by a made up category", actor: "admin", kind: "refused", method: "GET", path: () => "/api/tickets?statusCategory=NOPE", expect: 400, expectError: "Invalid status category" },
  { name: "List tickets", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/tickets", expect: 403, expectError: "view tickets" },
  { name: "List tickets", actor: "oppViewer", kind: "refused", method: "GET", path: () => "/api/tickets", expect: 403, expectError: "view tickets" },
  { name: "List tickets", actor: "ticketSettings", kind: "refused", method: "GET", path: () => "/api/tickets", expect: 403, expectError: "view tickets" },

  // The paged list: views, column filters, sort, and paging, always under
  // the visibility rule (src/lib/ticket-list.ts)
  { name: "List tickets: paged with stats", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets?view=all", expect: 200, contains: (c) => ['"pageSize":50', '"stats"', '"total"', c.fx.basicTicketId] },
  { name: "List tickets: My tickets view", actor: "ticketBasic", kind: "allowed", method: "GET", path: () => "/api/tickets?view=mine", expect: 200, contains: (c) => [c.fx.basicTicketId], notContains: (c) => [c.b.ticketId, c.fx.viewerTicketId] },
  { name: "List tickets: Unassigned view", actor: "ticketViewer", kind: "allowed", method: "GET", path: () => "/api/tickets?view=unassigned", expect: 200, contains: (c) => [c.b.ticketId], notContains: (c) => [c.fx.basicTicketId, c.fx.viewerTicketId, c.fx.alertsTicketId] },
  { name: "List tickets: Queue column filter", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets?view=all&f_queue=Alerts", expect: 200, contains: (c) => [c.fx.alertsTicketId], notContains: (c) => [c.fx.basicTicketId, c.b.ticketId] },
  { name: "List tickets: Queue column filter keeps visibility", actor: "ticketViewer", kind: "allowed", method: "GET", path: () => "/api/tickets?view=all&f_queue=Alerts", expect: 200, contains: () => ['"total":0'], notContains: (c) => [c.fx.alertsTicketId] },
  { name: "List tickets: Assignee column filter for Unassigned", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets?view=all&f_assignee=unassig", expect: 200, contains: (c) => [c.b.ticketId, c.fx.alertsTicketId], notContains: (c) => [c.fx.basicTicketId, c.fx.viewerTicketId] },
  { name: "List tickets: sorted by priority", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets?view=all&sort=priority&dir=desc", expect: 200, contains: (c) => [c.fx.basicTicketId] },
  { name: "List tickets: a page past the end", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/tickets?view=all&page=2", expect: 200, contains: () => ['"tickets":[]', '"page":2'], notContains: (c) => [c.fx.basicTicketId] },
  { name: "List tickets with a made up view", actor: "admin", kind: "refused", method: "GET", path: () => "/api/tickets?view=nope", expect: 400, expectError: "Invalid view" },
  { name: "List tickets with a made up sort", actor: "admin", kind: "refused", method: "GET", path: () => "/api/tickets?sort=nope", expect: 400, expectError: "Invalid sort" },
  { name: "List tickets with page 0", actor: "admin", kind: "refused", method: "GET", path: () => "/api/tickets?page=0", expect: 400, expectError: "Invalid page" },
  { name: "List tickets with a made up sort direction", actor: "admin", kind: "refused", method: "GET", path: () => "/api/tickets?sort=number&dir=up", expect: 400, expectError: "Invalid sort direction" },

  // The client page's Tickets tab: the client's tickets the user may open
  { name: "Client tickets tab", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/tickets?status=all`, expect: 200, contains: (c) => [c.fx.basicTicketId, c.fx.viewerTicketId, c.b.ticketId, c.fx.alertsTicketId] },
  { name: "Client tickets tab: own and the team's unassigned", actor: "ticketBasic", kind: "allowed", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/tickets`, expect: 200, contains: (c) => [c.fx.basicTicketId, c.b.ticketId], notContains: (c) => [c.fx.viewerTicketId, c.fx.alertsTicketId] },
  { name: "Client tickets tab: closed ones", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/tickets?status=closed`, expect: 200, notContains: (c) => [c.fx.basicTicketId, c.b.ticketId] },
  { name: "Client tickets tab for a made up client", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.fakeId}/tickets`, expect: 404, expectError: "Not found" },
  { name: "Client tickets tab with a made up filter", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/tickets?status=nope`, expect: 400, expectError: "Invalid status filter" },
  { name: "Client tickets tab", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/tickets`, expect: 403, expectError: "view tickets" },
  { name: "Client tickets tab", actor: "clerk", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/tickets`, expect: 403, expectError: "view tickets" },
  // The client page's Opportunities tab: the Opportunities list's visibility
  { name: "Client opportunities tab", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities?status=all`, expect: 200, contains: (c) => [c.b.opportunityId, c.fx.repOpportunityId, c.fx.unassignedOpportunityId] },
  { name: "Client opportunities tab: the team's unassigned, never others' own", actor: "oppViewer", kind: "allowed", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities?status=all`, expect: 200, contains: (c) => [c.fx.unassignedOpportunityId], notContains: (c) => [c.b.opportunityId, c.fx.repOpportunityId] },
  { name: "Client opportunities tab: won ones only", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities?status=won`, expect: 200, notContains: (c) => [c.b.opportunityId, c.fx.repOpportunityId, c.fx.unassignedOpportunityId] },
  { name: "Client opportunities tab for a made up client", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.fakeId}/opportunities`, expect: 404, expectError: "Not found" },
  { name: "Client opportunities tab with a made up filter", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities?status=nope`, expect: 400, expectError: "Invalid status filter" },
  { name: "Client opportunities tab with a bad page", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities?page=0`, expect: 400, expectError: "Invalid page" },
  { name: "Client opportunities tab", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities`, expect: 403, expectError: "view opportunities" },
  { name: "Client opportunities tab", actor: "clerk", kind: "refused", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/opportunities`, expect: 403, expectError: "view opportunities" },

  // Assignment and team rules
  { name: "Create for a teammate", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { teamId: c.b.helpdeskTeamId, assigneeId: c.fx.ticketViewerUserId }), expect: 403, expectError: "yourself or leave them unassigned" },
  { name: "Create for itself in its team", actor: "ticketBasic", kind: "allowed", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { teamId: c.b.helpdeskTeamId, assigneeId: c.fx.ticketBasicUserId }), expect: 200, check: createdTicketAssignedTo((c) => c.fx.ticketBasicUserId) },
  { name: "Create in a team it isn't in", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { teamId: c.fx.alertsTeamId }), expect: 403, expectError: "teams you belong to" },
  { name: "Create unassigned in the default team", actor: "ticketBasic", kind: "allowed", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c), expect: 200, check: createdTicketAssignedTo(() => null) },
  { name: "Create for a teammate", actor: "ticketDispatcher", kind: "allowed", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { teamId: c.b.helpdeskTeamId, assigneeId: c.fx.ticketViewerUserId }), expect: 200, check: createdTicketAssignedTo((c) => c.fx.ticketViewerUserId) },
  { name: "Create in another queue (dispatch)", actor: "ticketDispatcher", kind: "allowed", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { teamId: c.fx.alertsTeamId }), expect: 200, check: createdTicketAssignedTo(() => null) },
  { name: "Create with no client", actor: "ticketBasic", kind: "allowed", method: "POST", path: () => "/api/tickets", body: () => ({ initialNote: TICKET_NOTE, title: "Dev check ticket" }), expect: 200, check: createdTicketAssignedTo(() => null) },
  { name: "Create for someone outside the team", actor: "admin", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { teamId: c.b.helpdeskTeamId, assigneeId: c.repUserId }), expect: 400, expectError: "Assignee is not in this team" },
  { name: "Assign a ticket to a teammate", actor: "ticketBasic", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.b.ticketId}`, body: (c) => ({ assigneeId: c.fx.ticketViewerUserId }), expect: 403, expectError: "yourself or leave them unassigned" },
  { name: "Move to a team it isn't in", actor: "ticketBasic", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.fx.basicTicketId}`, body: (c) => ({ teamId: c.fx.alertsTeamId, assigneeId: null }), expect: 403, expectError: "teams you belong to" },
  { name: "Move away from its assignee's team, keeping the assignee", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.fx.viewerTicketId}`, body: (c) => ({ teamId: c.fx.alertsTeamId }), expect: 400, expectError: "not in the new team" },
  { name: "Clear the team", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.b.ticketId}`, body: () => ({ teamId: null }), expect: 400, expectError: "A team is required" },
  { name: "Clear the client, keeping a contact", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.b.ticketId}`, body: (c) => ({ clientId: null, contactId: c.b.contactId }), expect: 400, expectError: "A contact needs a client" },
  { name: "Clear the type", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.b.ticketId}`, body: () => ({ typeId: "" }), expect: 400, expectError: "A type is required" },
  { name: "Edit a ticket", actor: "ticketSettings", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.b.ticketId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit tickets" },
  { name: "Create a ticket", actor: "everyone", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c), expect: 403, expectError: "create tickets" },

  // The initial note is required, judged after sanitizing
  { name: "Create with no initial note", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ({ ...ticketBody(c), initialNote: undefined }), expect: 400, expectError: "An initial note is required" },
  { name: "Create with an empty initial note", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { initialNote: "<p></p>" }), expect: 400, expectError: "An initial note is required" },
  { name: "Create with a script only initial note", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ticketBody(c, { initialNote: "<script>alert(1)</script>" }), expect: 400, expectError: "An initial note is required" },
  { name: "Create with a contact and no client", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/tickets", body: (c) => ({ initialNote: TICKET_NOTE, title: "Should Not Exist", contactId: c.b.contactId }), expect: 400, expectError: "A contact needs a client" },

  // Ticket settings
  { name: "List ticket types", actor: "ticketSettings", kind: "allowed", method: "GET", path: () => "/api/ticket-types", expect: 200, contains: (c) => [c.b.ticketTypeId] },
  { name: "List ticket priorities", actor: "ticketSettings", kind: "allowed", method: "GET", path: () => "/api/ticket-priorities", expect: 200, contains: (c) => [c.b.ticketPriorityId] },
  { name: "List ticket statuses", actor: "ticketSettings", kind: "allowed", method: "GET", path: () => "/api/ticket-statuses", expect: 200, contains: (c) => [c.b.ticketStatusId, "WAITING"] },
  { name: "Read ticket settings", actor: "ticketSettings", kind: "allowed", method: "GET", path: () => "/api/ticket-settings", expect: 200, contains: (c) => ["autoCloseResolvedDays", c.b.helpdeskTeamId] },
  { name: "Read ticket settings", actor: "ticketBasic", kind: "allowed", method: "GET", path: () => "/api/ticket-settings", expect: 200, contains: () => ['"prefix":"T"'] },
  { name: "Reorder ticket types, same order", actor: "ticketSettings", kind: "allowed", method: "POST", path: () => "/api/ticket-types/reorder", body: (c) => ({ typeIds: c.fx.ticketTypeIds }), expect: 200, contains: (c) => [c.b.ticketTypeId] },
  { name: "Reorder ticket statuses, same order", actor: "ticketSettings", kind: "allowed", method: "POST", path: () => "/api/ticket-statuses/reorder", body: (c) => ({ statusIds: c.fx.ticketStatusIds }), expect: 200, contains: (c) => [c.b.ticketStatusId] },
  { name: "Add a ticket type", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/ticket-types", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: TICKET_WRITE },
  { name: "Add a ticket priority", actor: "ticketBasic", kind: "refused", method: "POST", path: () => "/api/ticket-priorities", body: () => ({ name: "Should Not Exist" }), expect: 403, expectError: TICKET_WRITE },
  { name: "Delete a ticket status", actor: "ticketBasic", kind: "refused", method: "DELETE", path: (c) => `/api/ticket-statuses/${c.fx.ticketWaitingStatusId}`, expect: 403, expectError: TICKET_WRITE },
  { name: "Change ticket settings", actor: "ticketBasic", kind: "refused", method: "PATCH", path: () => "/api/ticket-settings", body: () => ({ autoCloseResolvedDays: 3 }), expect: 403, expectError: TICKET_WRITE },
  { name: "Reorder ticket priorities", actor: "ticketDispatcher", kind: "refused", method: "POST", path: () => "/api/ticket-priorities/reorder", body: (c) => ({ priorityIds: [...c.fx.ticketPriorityIds].reverse() }), expect: 403, expectError: TICKET_WRITE },
  { name: "List ticket types", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/ticket-types", expect: 403, expectError: "view ticket types" },
  { name: "Read ticket settings", actor: "oppSettings", kind: "refused", method: "GET", path: () => "/api/ticket-settings", expect: 403, expectError: "view ticket settings" },
  { name: "Delete a ticket status in use", actor: "ticketSettings", kind: "refused", method: "DELETE", path: (c) => `/api/ticket-statuses/${c.fx.ticketOpenStatusId}`, expect: 409, expectError: "is used by" },
  { name: "Delete the only Closed status", actor: "ticketSettings", kind: "refused", method: "DELETE", path: (c) => `/api/ticket-statuses/${c.fx.ticketClosedStatusId}`, expect: 409, expectError: "only Closed status" },
  { name: "Change a status's category", actor: "ticketSettings", kind: "refused", method: "PATCH", path: (c) => `/api/ticket-statuses/${c.fx.ticketWaitingStatusId}`, body: () => ({ category: "OPEN" }), expect: 400, expectError: "category can't be changed" },
  { name: "Delete a ticket type in use", actor: "ticketSettings", kind: "refused", method: "DELETE", path: (c) => `/api/ticket-types/${c.b.ticketTypeId}`, expect: 409, expectError: "is used by" },
  { name: "Delete a ticket priority in use", actor: "ticketSettings", kind: "refused", method: "DELETE", path: (c) => `/api/ticket-priorities/${c.b.ticketPriorityId}`, expect: 409, expectError: "is used by" },
  { name: "Set a broken number prefix", actor: "ticketSettings", kind: "refused", method: "PATCH", path: () => "/api/ticket-settings", body: () => ({ prefix: "bad prefix!" }), expect: 400, expectError: "prefix" },
  { name: "Set negative auto close days", actor: "ticketSettings", kind: "refused", method: "PATCH", path: () => "/api/ticket-settings", body: () => ({ autoCloseResolvedDays: -1 }), expect: 400, expectError: "Auto close" },
  { name: "Set fractional auto close days", actor: "ticketSettings", kind: "refused", method: "PATCH", path: () => "/api/ticket-settings", body: () => ({ autoCloseResolvedDays: 2.5 }), expect: 400, expectError: "Auto close" },
  { name: "Clear the default team", actor: "ticketSettings", kind: "refused", method: "PATCH", path: () => "/api/ticket-settings", body: () => ({ defaultTeamId: null }), expect: 400, expectError: "A default team is required" },
  { name: "Add a status in a made up category", actor: "ticketSettings", kind: "refused", method: "POST", path: () => "/api/ticket-statuses", body: () => ({ name: "Should Not Exist", category: "NOPE" }), expect: 400, expectError: "Invalid status category" },
  { name: "Reorder ticket types with a missing type", actor: "ticketSettings", kind: "refused", method: "POST", path: () => "/api/ticket-types/reorder", body: (c) => ({ typeIds: [c.fx.ticketTypeIds[0]] }), expect: 409, expectError: "The type list changed" },
  { name: "Add a ticket type with another type's name", actor: "ticketSettings", kind: "refused", method: "POST", path: () => "/api/ticket-types", body: () => ({ name: "incident" }), expect: 400, expectError: "already exists" },

  // Action buttons on tickets: Note and Email only, never the opportunity ones
  { name: "Ticket action buttons", actor: "ticketBasic", kind: "allowed", method: "GET", path: () => "/api/action-buttons?for=ticket", expect: 200, contains: (c) => [c.fx.noteButtonId, c.fx.emailButtonId, c.fx.ticketButtonId], notContains: (c) => [c.fx.wonButtonId, c.fx.lostButtonId, c.b.actionButtonId] },
  { name: "Ticket action buttons", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/action-buttons?for=ticket", expect: 403, expectError: "view tickets" },
  { name: "Action button fixing a ticket status without being fixed", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/action-buttons/${c.fx.noteButtonId}`, body: (c) => ({ fixedTicketStatusId: c.fx.ticketResolvedStatusId }), expect: 400, expectError: "only be set when the button always moves" },
  { name: "Delete a ticket status a button moves to", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/ticket-statuses/${c.fx.ticketResolvedStatusId}`, expect: 409, expectError: "action button moves to this status" },
  { name: "Fixed ticket button with no ticket status", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ forOpportunities: false, forTickets: true, stageMode: "FIXED", fixedTicketStatusId: "" }), expect: 400, expectError: "Choose the ticket status" },
  { name: "Fixed ticket button with a made up ticket status", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: (c) => buttonBody({ forOpportunities: false, forTickets: true, stageMode: "FIXED", fixedTicketStatusId: c.fakeId }), expect: 400, expectError: "Invalid status" },
  { name: "Ticket status on a button that doesn't change it", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: (c) => buttonBody({ forTickets: true, fixedTicketStatusId: c.fx.ticketResolvedStatusId }), expect: 400, expectError: "only be set when the button always moves" },
  { name: "Make the Resolve button forget its ticket status", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/action-buttons/${c.fx.ticketButtonId}`, body: () => ({ fixedTicketStatusId: null }), expect: 400, expectError: "Choose the ticket status" },

  // Notes
  { name: "Note on a teammate's ticket", actor: "ticketBasic", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.fx.viewerTicketId}/timeline`, body: () => ({ body: TICKET_NOTE }), expect: 404, expectError: "Not found" },
  { name: "Note on a ticket", actor: "ticketSettings", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/timeline`, body: () => ({ body: TICKET_NOTE }), expect: 403, expectError: "edit tickets" },
  { name: "Note through the Won button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/timeline`, body: (c) => ({ body: TICKET_NOTE, actionButtonId: c.fx.wonButtonId }), expect: 400, expectError: "Invalid action button" },
  { name: "Note through the Email button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/timeline`, body: (c) => ({ body: TICKET_NOTE, actionButtonId: c.fx.emailButtonId }), expect: 400, expectError: "Invalid action button" },
  { name: "Note with a made up status", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/timeline`, body: (c) => ({ body: TICKET_NOTE, statusId: c.fakeId }), expect: 400, expectError: "Invalid status" },
  { name: "Empty note", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/timeline`, body: () => ({ body: "<p></p>" }), expect: 400, expectError: "can't be empty" },
  { name: "Edit someone else's note", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/tickets/${c.b.ticketId}/timeline/${c.fx.ticketBasicNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 403, expectError: "your own notes" },
  { name: "Delete someone else's note", actor: "ticketBasic", kind: "refused", method: "DELETE", path: (c) => `/api/tickets/${c.b.ticketId}/timeline/${c.b.ticketNoteId}`, expect: 403, expectError: "your own notes" },
  { name: "Timeline paged with another ticket's entry", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.basicTicketId}/timeline?cursor=${c.b.ticketNoteId}`, expect: 400, expectError: "Invalid cursor" },

  // The Email action, only ever with input refused before anything is sent
  { name: "Email from a teammate's ticket", actor: "ticketBasic", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.fx.viewerTicketId}/email`, body: () => emailBody(), expect: 404, expectError: "Not found" },
  { name: "Send a ticket email (no edit)", actor: "everyone", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/email`, body: () => emailBody(), expect: 403, expectError: "edit tickets" },
  { name: "Ticket email to an invalid address", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/email`, body: () => emailBody({ to: ["not-an-address"] }), expect: 400, expectError: "is not a valid email address" },
  { name: "Ticket email with an opportunity's attachment", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/email`, body: (c) => emailBody({ attachmentIds: [c.b.opportunityAttachmentId] }), expect: 400, expectError: "Invalid attachment" },
  { name: "Ticket email through the Won button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/email`, body: (c) => emailBody({ actionButtonId: c.fx.wonButtonId }), expect: 400, expectError: "Invalid action button" },
  { name: "Ticket email through the Email button with a status", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/email`, body: (c) => emailBody({ actionButtonId: c.fx.emailButtonId, statusId: c.fx.ticketResolvedStatusId }), expect: 400, expectError: "doesn't change the status" },

  // Delete, restore, audit
  { name: "Delete a ticket", actor: "ticketBasic", kind: "refused", method: "DELETE", path: (c) => `/api/tickets/${c.b.ticketId}`, expect: 403, expectError: "delete tickets" },
  { name: "Delete a ticket it can't open", actor: "ticketDispatcher", kind: "refused", method: "DELETE", path: (c) => `/api/tickets/${c.fx.alertsTicketId}`, expect: 404, expectError: "Not found" },
  { name: "Restore a ticket", actor: "ticketBasic", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/restore`, expect: 403, expectError: AUDIT_RESTORE },
  { name: "Restore a ticket that isn't deleted", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/tickets/${c.b.ticketId}/restore`, expect: 409, expectError: "isn't deleted" },
  { name: "Read a ticket's audit log", actor: "admin", kind: "allowed", method: "GET", path: (c) => `/api/tickets/${c.b.ticketId}/audit`, expect: 200, contains: (c) => [c.b.ticketAuditEntryId] },
  { name: "Read a ticket's audit log", actor: "auditViewer", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.b.ticketId}/audit`, expect: 404, expectError: "Not found" },
  { name: "Read a ticket's audit log", actor: "ticketBasic", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.b.ticketId}/audit`, expect: 403, expectError: AUDIT_VIEW },
  { name: "Ticket audit log paged with another ticket's entry", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/tickets/${c.fx.basicTicketId}/audit?cursor=${c.b.ticketAuditEntryId}`, expect: 400, expectError: "Invalid cursor" },
  { name: "Audit log filtered to tickets", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/audit-log?recordType=TICKET", expect: 200, contains: (c) => [c.b.ticketAuditEntryId], notContains: (c) => [c.b.auditEntryId] },

  // Round robin on teams, and a queue holding tickets
  { name: "Turn round robin off", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/teams/${c.fx.roundRobinTeamId}`, body: () => ({ roundRobinEnabled: false }), expect: 403, expectError: TEAM_WRITE },
  { name: "Set round robin to text", actor: "teamManager", kind: "refused", method: "PATCH", path: (c) => `/api/teams/${c.fx.roundRobinTeamId}`, body: () => ({ roundRobinEnabled: "yes" }), expect: 400, expectError: "Round robin must be true or false" },
  { name: "Keep round robin on", actor: "teamManager", kind: "allowed", method: "PATCH", path: (c) => `/api/teams/${c.fx.roundRobinTeamId}`, body: () => ({ roundRobinEnabled: true }), expect: 200, contains: () => ['"roundRobinEnabled":true'] },
  { name: "Delete a queue holding tickets", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/teams/${c.b.helpdeskTeamId}`, expect: 409, expectError: "This team has" },
]

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
  catalogList("admin", "control", true),
  { name: "Catalog order history shows everyone's sales orders", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/order-history`, expect: 200, contains: (c) => [c.b.salesOrderId, c.fx.clerkSalesOrderId] },
  { name: "Vendor purchase orders shows everyone's", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/purchase-orders`, expect: 200, contains: (c) => [c.b.purchaseOrderId, c.fx.clerkPurchaseOrderId] },
  { name: "Users list, with email addresses", actor: "admin", kind: "control", method: "GET", path: () => "/api/users", expect: 200, contains: (c) => [c.names.adminEmail] },
  { name: "Roles list, with permissions", actor: "admin", kind: "control", method: "GET", path: () => "/api/roles", expect: 200, contains: () => ['"permissions"'] },
  { name: "List sales orders shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/sales-orders", expect: 200, contains: (c) => [c.b.salesOrderId, c.fx.ordersSalesOrderId] },
  { name: "Open a sales order, with cost", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 200, contains: (c) => [c.fx.ordersSalesOrderId, '"cost"'] },
  { name: "List purchase orders shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/purchase-orders", expect: 200, contains: (c) => [c.b.purchaseOrderId, c.fx.ordersPurchaseOrderId] },
  { name: "Open a purchase order, with cost", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId, '"unitCost"'] },
  { name: "SO and PO settings", actor: "admin", kind: "control", method: "GET", path: () => "/api/so-po-settings", expect: 200, contains: () => ["soPrefix"] },
  { name: "Notification settings", actor: "admin", kind: "control", method: "GET", path: () => "/api/notification-settings", expect: 200, contains: () => ["emailSignature"] },
  { name: "Approval workflows", actor: "admin", kind: "control", method: "GET", path: () => "/api/approval-workflows", expect: 200, contains: (c) => [c.b.workflowId] },
  { name: "Open purchase orders widget", actor: "admin", kind: "control", method: "GET", path: () => "/api/dashboards/widget-data?type=OPEN_POS", expect: 200, contains: () => ['"count"'] },

  // ── Positive controls: Test Orders B (both order pages, create and edit
  // on both, no viewAll, no generatePO). Edits send the stored values. ──
  { name: "List sales orders shows only own", actor: "orders", kind: "control", method: "GET", path: () => "/api/sales-orders", expect: 200, contains: (c) => [c.fx.ordersSalesOrderId], notContains: (c) => [c.b.salesOrderId, c.fx.clerkSalesOrderId] },
  { name: "Open own sales order, with cost", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 200, contains: (c) => [c.fx.ordersSalesOrderId, '"cost"'] },
  { name: "Edit own sales order (same notes)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, body: (c) => ({ internalNotes: c.names.ordersSalesOrder }), expect: 200, contains: (c) => [c.fx.ordersSalesOrderId] },
  { name: "Edit own sales order line item (same name)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/line-items/${c.fx.ordersSoLineId}`, body: (c) => ({ name: c.names.ordersSoLine }), expect: 200, contains: (c) => [c.fx.ordersSoLineId] },
  { name: "Own sales order comments", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/comments`, expect: 200, contains: () => ["["] },
  { name: "Own sales order attachments", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/attachments`, expect: 200, contains: () => ["["] },
  { name: "Create a sales order (no client, past the permission check)", actor: "orders", kind: "control", method: "POST", path: () => "/api/sales-orders", body: () => ({}), expect: 400, contains: () => ["A client is required"] },
  { name: "List purchase orders shows only own", actor: "orders", kind: "control", method: "GET", path: () => "/api/purchase-orders", expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId], notContains: (c) => [c.b.purchaseOrderId, c.b.purchaseOrder2Id, c.fx.clerkPurchaseOrderId] },
  { name: "Open own purchase order, with cost", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId, '"unitCost"'] },
  { name: "Edit own purchase order (same notes)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, body: (c) => ({ internalNotes: c.names.ordersPurchaseOrder }), expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId] },
  { name: "Edit own purchase order line item (same name)", actor: "orders", kind: "control", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.fx.ordersPoLineId}`, body: (c) => ({ name: c.names.ordersPoLine }), expect: 200, contains: (c) => [c.fx.ordersPoLineId] },
  { name: "Own purchase order comments", actor: "orders", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/comments`, expect: 200, contains: () => ["["] },
  // A manual purchase order, sent without a vendor: the 400 comes after the
  // purchaseOrders.create check, which shows it passed
  { name: "Create a manual purchase order (no vendor, past the permission check)", actor: "orders", kind: "control", method: "POST", path: () => "/api/purchase-orders", body: () => ({}), expect: 400, contains: () => ["A vendor is required"] },
  {
    name: "Open purchase orders widget counts only own",
    actor: "orders",
    kind: "control",
    method: "GET",
    path: () => "/api/dashboards/widget-data?type=OPEN_POS",
    expect: 200,
    check: (json, c, prisma) => openPOsCountOwn(json, c.b.companyId, c.fx.ordersUserId, prisma),
  },

  // ── Positive controls: Test Viewer B (both order pages and viewAll, no
  // edit, so no cost) and Test Templater B (Quote Settings only) ──
  { name: "List sales orders shows everyone's", actor: "viewer", kind: "control", method: "GET", path: () => "/api/sales-orders", expect: 200, contains: (c) => [c.b.salesOrderId, c.fx.ordersSalesOrderId] },
  { name: "Open someone else's sales order, without cost", actor: "viewer", kind: "control", method: "GET", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 200, contains: (c) => [c.fx.ordersSalesOrderId], notContains: () => ['"cost"', '"unitCost"'] },
  { name: "Open someone else's purchase order, without cost", actor: "viewer", kind: "control", method: "GET", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 200, contains: (c) => [c.fx.ordersPurchaseOrderId], notContains: () => ['"unitCost"'] },
  { name: "Edit the cost template (same name)", actor: "templater", kind: "control", method: "PATCH", path: (c) => `/api/quote-templates/${c.fx.costTemplateId}`, body: (c) => ({ name: c.names.costTemplate }), expect: 200, contains: (c) => [c.fx.costTemplateId] },

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

  // ── Positive controls: Test Clerk B (Clients, Vendors, Catalog, and
  // Inventory pages, clients.create, clients.edit) ──
  // Edits send the sample record's current values, so nothing really
  // changes. A create that would add a record is sent incomplete instead:
  // the 400 it gets comes after the permission check, which shows it passed.
  { name: "Open a client", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/clients/${c.b.clientId}`, expect: 200, contains: (c) => [c.b.clientId] },
  {
    name: "Edit a client (same values)",
    actor: "clerk",
    kind: "control",
    method: "PATCH",
    path: (c) => `/api/clients/${c.b.clientId}`,
    body: (c) => ({ name: c.names.client, industryId: c.b.industryId, mainBillingLocationId: c.b.clientLocationId, mainShippingLocationId: c.b.clientLocationId }),
    expect: 200,
    contains: (c) => [c.b.clientId],
  },
  {
    name: "Edit a client contact (same values)",
    actor: "clerk",
    kind: "control",
    method: "PATCH",
    path: (c) => `/api/clients/${c.b.clientId}/contacts/${c.b.contactId}`,
    // Every field the run data stores: the contact PATCH saves the whole
    // form, so a field left out is cleared (the mobile included, which the
    // opportunity client details controls below look for)
    body: (c) => ({ firstName: c.names.contactFirstName, lastName: c.names.contactLastName, email: c.names.contactEmail, mobile: c.names.contactMobile, locationId: c.b.clientLocationId, isPrimary: true }),
    expect: 200,
    contains: (c) => [c.b.contactId],
  },
  {
    name: "Edit a client location (same values)",
    actor: "clerk",
    kind: "control",
    method: "PATCH",
    path: (c) => `/api/clients/${c.b.clientId}/locations/${c.b.clientLocationId}`,
    body: (c) => ({
      name: c.names.clientLocation,
      address: c.names.clientLocationAddress,
      city: c.names.clientLocationCity,
      isPrimary: true,
      billingContactId: c.b.contactId,
      shippingContactId: c.b.contactId,
    }),
    expect: 200,
    contains: (c) => [c.b.clientLocationId],
  },
  { name: "Import clients (empty, past the permission check)", actor: "clerk", kind: "control", method: "POST", path: () => "/api/clients/import", body: () => ({ rows: [] }), expect: 400, contains: () => ["No rows to import"] },
  // Allowed by clients.create or clients.edit, for the client forms. The
  // existing name comes back as is, so nothing is added.
  { name: "Add an existing industry inline", actor: "clerk", kind: "control", method: "POST", path: () => "/api/industries", body: (c) => ({ name: c.names.industry }), expect: 200, contains: (c) => [c.b.industryId] },
  { name: "Client assets", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/clients/${c.b.clientId}/assets`, expect: 200, contains: () => ["["] },
  catalogList("clerk", "control", true),
  { name: "Open a catalog item", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}`, expect: 200, contains: (c) => [c.b.catalogItemId, '"cost"'] },
  { name: "Catalog change log", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/catalog/${c.b.catalogItemId}/change-log`, expect: 200, contains: () => ["["] },
  {
    name: "Catalog order history shows only own sales orders",
    actor: "clerk",
    kind: "control",
    method: "GET",
    path: (c) => `/api/catalog/${c.b.catalogItemId}/order-history`,
    expect: 200,
    contains: (c) => [c.fx.clerkSalesOrderId],
    notContains: (c) => [c.b.salesOrderId],
  },
  { name: "Create a catalog item (no category, past the permission check)", actor: "clerk", kind: "control", method: "POST", path: () => "/api/catalog", body: () => ({ name: "Should Not Exist" }), expect: 400, contains: () => ["Category is required"] },
  { name: "Open a vendor", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}`, expect: 200, contains: (c) => [c.b.vendorId] },
  { name: "Edit a vendor (same name)", actor: "clerk", kind: "control", method: "PATCH", path: (c) => `/api/vendors/${c.b.vendorId}`, body: (c) => ({ name: c.names.vendor }), expect: 200, contains: (c) => [c.b.vendorId] },
  { name: "Vendor attachments", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/vendors/${c.b.vendorId}/attachments`, expect: 200, contains: (c) => [c.b.vendorAttachmentId] },
  {
    name: "Vendor purchase orders shows only own",
    actor: "clerk",
    kind: "control",
    method: "GET",
    path: (c) => `/api/vendors/${c.b.vendorId}/purchase-orders`,
    expect: 200,
    contains: (c) => [c.fx.clerkPurchaseOrderId],
    notContains: (c) => [c.b.purchaseOrderId, c.b.purchaseOrder2Id],
  },
  { name: "List inventory assets", actor: "clerk", kind: "control", method: "GET", path: () => "/api/inventory-assets", expect: 200, contains: (c) => [c.b.assetId] },
  { name: "Open an inventory asset", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}`, expect: 200, contains: (c) => [c.b.assetId] },
  { name: "Asset attachments", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/inventory-assets/${c.b.assetId}/attachments`, expect: 200, contains: (c) => [c.b.assetAttachmentId] },
  { name: "A site's containers", actor: "clerk", kind: "control", method: "GET", path: (c) => `/api/inventory-locations?clientLocationId=${c.b.clientLocationId}`, expect: 200, contains: (c) => [c.fx.containerId] },
  { name: "Rename a container (same name)", actor: "clerk", kind: "control", method: "PATCH", path: (c) => `/api/inventory-locations/${c.fx.containerId}`, body: (c) => ({ name: c.names.container }), expect: 200, contains: (c) => [c.fx.containerId] },
  { name: "Own company containers", actor: "clerk", kind: "control", method: "GET", path: () => "/api/inventory-locations/own-company", expect: 200, contains: () => ["["] },
  { name: "List inventory stock", actor: "clerk", kind: "control", method: "GET", path: () => "/api/inventory-stock", expect: 200, contains: (c) => [c.fx.stockId] },
  { name: "Adjust inventory stock by zero (past the permission check)", actor: "clerk", kind: "control", method: "PATCH", path: (c) => `/api/inventory-stock/${c.fx.stockId}/adjust`, body: () => ({ delta: 0 }), expect: 400, contains: () => ["non-zero"] },

  // ── Positive controls: opportunities ──
  // Global Admin B sees all three sample opportunities; Test Rep B (no see
  // all) its own and the unassigned one; Test Opp Viewer B (no see all,
  // owns none) only the unassigned one; Test Opp Settings B manages
  // stages, types, and settings. Its writes save the values already stored.
  { name: "List opportunities shows everyone's", actor: "admin", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.b.opportunityId, c.fx.repOpportunityId, c.fx.unassignedOpportunityId] },
  { name: "Open the Rep's opportunity", actor: "admin", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, expect: 200, contains: (c) => [c.fx.repOpportunityId] },
  { name: "List opportunities: own and unassigned only", actor: "rep", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.repOpportunityId, c.fx.unassignedOpportunityId], notContains: (c) => [c.b.opportunityId] },
  { name: "Open own opportunity", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, expect: 200, contains: (c) => [c.fx.repOpportunityId] },
  { name: "Own opportunity attachments", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/attachments`, expect: 200, contains: (c) => [c.fx.repOpportunityAttachmentId] },
  { name: "List opportunities: unassigned only", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.unassignedOpportunityId], notContains: (c) => [c.b.opportunityId, c.fx.repOpportunityId] },
  { name: "Open the unassigned opportunity", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 200, contains: (c) => [c.fx.unassignedOpportunityId] },
  { name: "Unassigned opportunity attachments", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expect: 200, contains: (c) => [c.fx.unassignedOpportunityAttachmentId] },
  { name: "Opportunity stages", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunity-stages", expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Opportunity types", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunity-types", expect: 200, contains: (c) => [c.b.opportunityTypeId] },
  { name: "Opportunity settings", actor: "oppViewer", kind: "control", method: "GET", path: () => "/api/opportunity-settings", expect: 200, contains: () => ['"prefix"'] },
  { name: "Opportunity stages", actor: "oppSettings", kind: "control", method: "GET", path: () => "/api/opportunity-stages", expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Opportunity settings", actor: "oppSettings", kind: "control", method: "GET", path: () => "/api/opportunity-settings", expect: 200, contains: () => ['"prefix"'] },
  { name: "Save opportunity settings unchanged", actor: "oppSettings", kind: "control", method: "PATCH", path: () => "/api/opportunity-settings", body: () => ({ prefix: "OPP" }), expect: 200, contains: () => ['"prefix":"OPP"'] },
  { name: "Rename a stage to its own name", actor: "oppSettings", kind: "control", method: "PATCH", path: (c) => `/api/opportunity-stages/${c.b.opportunityStageId}`, body: () => ({ name: "New" }), expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Rename a type to its own name", actor: "oppSettings", kind: "control", method: "PATCH", path: (c) => `/api/opportunity-types/${c.b.opportunityTypeId}`, body: () => ({ name: "New Business" }), expect: 200, contains: (c) => [c.b.opportunityTypeId] },
  { name: "Reorder stages in their current order", actor: "oppSettings", kind: "control", method: "POST", path: () => "/api/opportunity-stages/reorder", body: (c) => ({ stageIds: c.fx.opportunityStageIds }), expect: 200, contains: (c) => [c.b.opportunityStageId] },
  { name: "Reorder types in their current order", actor: "oppSettings", kind: "control", method: "POST", path: () => "/api/opportunity-types/reorder", body: (c) => ({ typeIds: c.fx.opportunityTypeIds }), expect: 200, contains: (c) => [c.b.opportunityTypeId] },
  { name: "Own opportunity related records", actor: "rep", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/related`, expect: 200, contains: () => ['"quotes"', '"salesOrders"', '"purchaseOrders"'] },
  // Client details come with an opportunity the user may open, and never with the list
  { name: "Unassigned opportunity with client details", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 200, contains: (c) => [c.b.clientId, '"mainBillingLocation"', '"locations"', '"title"', '"email"'] },
  { name: "Unassigned opportunity with the contact's mobile", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 200, contains: (c) => [c.names.contactMobile, '"clientLocation"'] },
  { name: "List opportunities without the contact's mobile", actor: "admin", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.unassignedOpportunityId], notContains: (c) => [c.names.contactMobile] },
  { name: "List opportunities without client details", actor: "admin", kind: "control", method: "GET", path: () => "/api/opportunities", expect: 200, contains: (c) => [c.fx.unassignedOpportunityId], notContains: () => ['"mainBillingLocation"', '"locations"'] },
  { name: "Unassigned opportunity timeline", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, expect: 200, contains: (c) => [c.fx.unassignedRepNoteId, c.fx.unassignedAdminNoteId, c.fx.unassignedActionId] },
  { name: "Unassigned opportunity related records", actor: "oppViewer", kind: "control", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/related`, expect: 200, contains: () => ['"quotes"'] },

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
  // A widget the user may not see answers with no data rather than a 403,
  // so a shared dashboard shows a no access note instead of an error
  noAccessWidget("everyone", "OPEN_QUOTES"),
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
  { name: "Copy admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/copy`, body: (c) => ({ clientId: c.b.clientId, contactId: c.b.contactId }), expect: 404, expectError: "Not found" },
  { name: "Copy own quote without a client or contact", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/copy`, expect: 400, expectError: "A client is required" },
  { name: "New version of admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/versions`, expect: 404, expectError: "Not found" },
  { name: "Flag admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/flag`, expect: 404, expectError: "Not found" },
  { name: "Reactivate admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/reactivate`, expect: 404, expectError: "Not found" },
  { name: "Add a section to admin's quote", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/sections`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Assign admin's quote to self", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.b.quoteId}/assign`, body: (c) => ({ userId: c.repUserId }), expect: 404, expectError: "Not found" },
  // Without quotes.viewAllUsersQuotes a quote can only be assigned to
  // yourself, so another company's user gets the same refusal as a
  // colleague (the admin's attempt below still checks "Invalid user")
  { name: "Assign own quote to another company's user", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.c.adminId }), expect: 403, expectError: "You can only assign quotes to yourself" },
  { name: "Assign own quote to another rep", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.b.adminId }), expect: 403, expectError: "You can only assign quotes to yourself" },
  { name: "Create a quote assigned to another rep", actor: "rep", kind: "refused", method: "POST", path: () => "/api/quotes", body: (c) => ({ clientId: c.b.clientId, contactId: c.b.contactId, userId: c.b.adminId }), expect: 403, expectError: "You can only assign quotes to yourself" },
  { name: "Assign own quote to self", actor: "rep", kind: "allowed", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.repUserId }), expect: 200, notContains: () => ['"accessToken"'] },
  { name: "Assign the rep's quote to another company's user", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.repQuoteId}/assign`, body: (c) => ({ userId: c.c.adminId }), expect: 400, expectError: "Invalid user" },
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

  // ── Sales orders, purchase orders, settings, users, and roles ──
  // Test Everyone B: refused every guarded route, allowed the reads any
  // active user may make, and no data from widgets it may not see
  ...ORDER_GUARDED.map(refusedFor("everyone")),
  ...SETTINGS_GUARDED.map(refusedFor("everyone")),
  ...activeReadsFor("everyone"),
  noAccessWidget("everyone", "OPEN_POS"),
  noAccessWidget("everyone", "INVENTORY_BY_STATUS"),
  noAccessWidget("everyone", "INVENTORY_BY_CLIENT"),
  noAccessWidget("everyone", "TOTAL_CLIENTS"),
  // Test Rep B and Test Clerk B hold neither order page
  ...ORDER_GUARDED.map(refusedFor("rep")),
  ...ORDER_GUARDED.map(refusedFor("clerk")),

  // Test Orders B: only its own orders, and nothing it holds no key for
  { name: "Open the admin's sales order", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expect: 404, expectError: "Not found" },
  { name: "Edit the admin's sales order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Add a line item to the admin's sales order", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's sales order line item", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's line item under own sales order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/line-items/${c.b.soLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Delete the admin's sales order line item", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/line-items/${c.b.soLineId}`, expect: 404, expectError: "Not found" },
  { name: "Read the admin's sales order comments", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Comment on the admin's sales order", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/comments`, body: () => ({ message: "Should not exist" }), expect: 404, expectError: "Not found" },
  { name: "The admin's sales order attachments", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments`, expect: 404, expectError: "Not found" },
  { name: "Delete the admin's sales order attachment", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/sales-orders/${c.b.salesOrderId}/attachments/${c.b.soAttachmentId}`, expect: 404, expectError: "Not found" },
  { name: "Delete own sales order", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, expect: 403, expectError: "delete sales orders" },
  { name: "Change own sales order's status", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, body: () => ({ status: "CLOSED" }), expect: 403, expectError: "change a sales order's status" },
  { name: "Generate a purchase order from own sales order lines", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.fx.ordersSalesOrderId, soLineItemIds: [c.fx.ordersSoLineId] }), expect: 403, expectError: "generate purchase orders" },
  { name: "Generate a purchase order from the admin's sales order lines", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.b.salesOrderId, soLineItemIds: [c.b.soLineId] }), expect: 403, expectError: "generate purchase orders" },
  { name: "Open the admin's purchase order", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, expect: 404, expectError: "Not found" },
  { name: "Edit the admin's purchase order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Add a line item to the admin's purchase order", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items`, body: () => ({ name: "Should Not Exist" }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's purchase order line item", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ name: "Changed", received: true }), expect: 404, expectError: "Not found" },
  { name: "Edit the admin's line item under own purchase order", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ name: "Changed" }), expect: 404, expectError: "Not found" },
  { name: "Receive the admin's purchase order line item", actor: "orders", kind: "refused", method: "POST", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}/receive`, body: () => ({}), expect: 404, expectError: "Not found" },
  { name: "Read the admin's purchase order comments", actor: "orders", kind: "refused", method: "GET", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/comments`, expect: 404, expectError: "Not found" },
  { name: "Delete the admin's purchase order attachment", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/attachments/${c.b.poAttachmentId}`, expect: 404, expectError: "Not found" },
  { name: "Delete own purchase order", actor: "orders", kind: "refused", method: "DELETE", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, expect: 403, expectError: "delete purchase orders" },
  { name: "Change own purchase order's status", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, body: () => ({ status: "CANCELLED" }), expect: 403, expectError: "change a purchase order's status" },
  { name: "SO and PO settings", actor: "orders", kind: "refused", method: "GET", path: () => "/api/so-po-settings", expect: 403, expectError: "sales order and purchase order settings" },
  ...activeReadsFor("orders"),

  // Test Viewer B: sees every order, edits none
  { name: "Edit someone else's sales order", actor: "viewer", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 403, expectError: "edit sales orders" },
  { name: "Edit a sales order line item", actor: "viewer", kind: "refused", method: "PATCH", path: (c) => `/api/sales-orders/${c.fx.ordersSalesOrderId}/line-items/${c.fx.ordersSoLineId}`, body: () => ({ cost: 1 }), expect: 403, expectError: "edit sales orders" },
  { name: "Edit someone else's purchase order", actor: "viewer", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}`, body: () => ({ internalNotes: "Changed" }), expect: 403, expectError: "edit purchase orders" },
  { name: "Generate a purchase order", actor: "viewer", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.fx.ordersSalesOrderId, soLineItemIds: [c.fx.ordersSoLineId] }), expect: 403, expectError: "create purchase orders" },

  // Cost on line item routes: a user who can't see cost can't set it
  {
    name: "Add a template line with a bogus cost: stored cost is the catalog cost",
    actor: "templater",
    kind: "allowed",
    method: "POST",
    path: (c) => `/api/quote-templates/${c.fx.costTemplateId}/line-items`,
    body: (c) => ({ name: "Dev check cost line", catalogItemId: c.b.catalogItemId, unitPrice: 100, cost: 9999 }),
    expect: 200,
    check: (json, _c, prisma) => templateLineUsesCatalogCost(json, prisma),
  },
  {
    name: "Edit a template line's cost: stored cost is unchanged",
    actor: "templater",
    kind: "allowed",
    method: "PATCH",
    path: (c) => `/api/quote-templates/${c.fx.costTemplateId}/line-items/${c.fx.costTemplateLineId}`,
    body: (c) => ({ name: c.names.costTemplateLine, cost: 1 }),
    expect: 200,
    notContains: () => ['"cost"'],
    check: async (_json, c, prisma) => {
      const row = await prisma.quoteTemplateLineItem.findUnique({ where: { id: c.fx.costTemplateLineId }, select: { cost: true } })
      return row?.cost === SAMPLE_ITEM_COST ? null : `stored cost is ${row?.cost}, expected it to stay ${SAMPLE_ITEM_COST}`
    },
  },
  {
    name: "Edit a catalog item without a cost field: cost and category unchanged",
    actor: "clerk",
    kind: "allowed",
    method: "PATCH",
    path: (c) => `/api/catalog/${c.b.catalogItemId}`,
    body: (c) => ({ name: c.names.catalogItem }),
    expect: 200,
    check: async (_json, c, prisma) => {
      const row = await prisma.catalogItem.findUnique({ where: { id: c.b.catalogItemId }, select: { cost: true, categoryId: true } })
      if (row?.cost !== SAMPLE_ITEM_COST) return `cost is ${row?.cost}, expected it to stay ${SAMPLE_ITEM_COST}`
      return row.categoryId === c.b.categoryId ? null : "the category changed"
    },
  },
  { name: "SO and PO settings", actor: "templater", kind: "refused", method: "GET", path: () => "/api/so-po-settings", expect: 403, expectError: "sales order and purchase order settings" },
  { name: "Open a sales order", actor: "templater", kind: "refused", method: "GET", path: (c) => `/api/sales-orders/${c.b.salesOrderId}`, expect: 403, expectError: "view sales orders" },
  // Quote Settings users read the templates they maintain
  { name: "List quote templates", actor: "templater", kind: "allowed", method: "GET", path: () => "/api/quote-templates", expect: 200, contains: (c) => [c.b.templateId, c.fx.costTemplateId] },
  { name: "Open a quote template", actor: "templater", kind: "allowed", method: "GET", path: (c) => `/api/quote-templates/${c.fx.costTemplateId}`, expect: 200, contains: (c) => [c.fx.costTemplateId], notContains: () => ['"cost"'] },

  // ── Purchase order received flag: an inventory tracked line (the sample
  // catalog item is Physical) is only received through Receive ──
  { name: "Mark own tracked purchase order line received", actor: "orders", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.fx.ordersPoLineId}`, body: () => ({ received: true }), expect: 400, expectError: "Use Receive to add this item to inventory" },
  { name: "Mark a tracked purchase order line received", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/purchase-orders/${c.b.purchaseOrderId}/line-items/${c.b.poLineId}`, body: () => ({ received: true }), expect: 400, expectError: "Use Receive to add this item to inventory" },
  {
    name: "Mark own untracked purchase order line received (then put back)",
    actor: "orders",
    kind: "allowed",
    method: "PATCH",
    path: (c) => `/api/purchase-orders/${c.fx.ordersPurchaseOrderId}/line-items/${c.untrackedPoLineId}`,
    body: () => ({ received: true }),
    expect: 200,
    check: async (_json, c, prisma) => {
      const row = await prisma.pOLineItem.findUnique({ where: { id: c.untrackedPoLineId }, select: { received: true } })
      await prisma.pOLineItem.update({ where: { id: c.untrackedPoLineId }, data: { received: false } })
      return row?.received === true ? null : "the line is not marked received"
    },
  },

  // ── A manual purchase order may only name a sales order its creator can open ──
  { name: "Manual purchase order naming the admin's sales order", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.b.salesOrderId }), expect: 400, expectError: "Invalid sales order" },
  { name: "Manual purchase order naming another company's sales order", actor: "orders", kind: "refused", method: "POST", path: () => "/api/purchase-orders", body: (c) => ({ vendorId: c.b.vendorId, salesOrderId: c.c.salesOrderId }), expect: 400, expectError: "Invalid sales order" },

  // ── Invites: another company's email gets the generic answer, and a
  // non Global Admin can't invite at or above their own rank ──
  { name: "Invite another company's user email", actor: "admin", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: c.namesC.adminEmail, tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "This email cannot be used" },
  { name: "Invite an email that isn't an email", actor: "admin", kind: "refused", method: "POST", path: () => "/api/users", body: () => ({ name: "Should Not Exist", email: "not-an-email", tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "This email cannot be used" },
  { name: "Invite an email already used in this company", actor: "admin", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: c.names.repEmail, tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "A user with that email already exists" },
  { name: "Invite into own role (same rank)", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: "should-not-exist-manager@example.test", tempPassword: "ShouldNotExist123", roleIds: [c.managerRoleId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Invite into Global Admin", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: "should-not-exist-manager@example.test", tempPassword: "ShouldNotExist123", roleIds: [c.b.globalAdminRoleId] }), expect: 403, expectError: "at or above your own rank" },
  { name: "Invite another company's user email", actor: "manager", kind: "refused", method: "POST", path: () => "/api/users", body: (c) => ({ name: "Should Not Exist", email: c.namesC.adminEmail, tempPassword: "ShouldNotExist123" }), expect: 400, expectError: "This email cannot be used" },

  // ── Clients, catalog, vendors, company settings lists, and inventory ──
  // Test Everyone B and Test Rep B: refused every guarded route, allowed the open pickers
  ...GUARDED.map(refusedFor("everyone")),
  ...PICKERS.map(pickerFor("everyone")),
  catalogList("everyone", "allowed", false),
  ...GUARDED.map(refusedFor("rep")),
  ...PICKERS.map(pickerFor("rep")),
  // quotes.edit is enough to see cost
  catalogList("rep", "allowed", true),
  // Test Clerk B: refused settings, deletes, and Remove (no inventory.delete)
  ...GUARDED.filter((g) => g.clerk).map(refusedFor("clerk")),
  // Test Sender B can't see cost (pages.quotes without quotes.edit)
  catalogList("sender", "allowed", false),
  {
    name: "Distributor search, without dealer pricing",
    actor: "sender",
    kind: "allowed",
    method: "GET",
    path: () => "/api/distributor-search?q=test",
    expect: 200,
    contains: () => ["products"],
    check: (json) => offersWithoutPricing(json),
  },

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
  // ── Number prefixes (round two, N-25): letters, digits, and hyphens only ──
  { name: "Quote number prefix with a quote and a space", actor: "admin", kind: "refused", method: "PATCH", path: () => "/api/quote-settings", body: () => ({ quotePrefix: 'Q "bad"' }), expect: 400, expectError: "Quote number prefix can only use" },
  { name: "Sales order number prefix with a space", actor: "admin", kind: "refused", method: "PATCH", path: () => "/api/so-po-settings", body: () => ({ soPrefix: "S O" }), expect: 400, expectError: "Sales order number prefix can only use" },
  { name: "Purchase order number prefix over 10 characters", actor: "admin", kind: "refused", method: "PATCH", path: () => "/api/so-po-settings", body: () => ({ poPrefix: "PURCHASEORD" }), expect: 400, expectError: "Purchase order number prefix can only use" },
  // ── Quote copy (quote correctness): a client and contact of this company are required ──
  { name: "Copy without a client or contact", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, expect: 400, expectError: "A client is required" },
  { name: "Copy with a client but no contact", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.fx.copyClientId }), expect: 400, expectError: "A contact is required" },
  { name: "Copy for another company's client", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.c.clientId, contactId: c.c.contactId }), expect: 400, expectError: "Invalid client" },
  { name: "Copy with another company's contact", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.b.clientId, contactId: c.c.contactId }), expect: 400, expectError: "Invalid contact" },
  { name: "Copy with a contact of a different client", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/quotes/${c.fx.copyQuoteId}/copy`, body: (c) => ({ clientId: c.b.clientId, contactId: c.fx.copyContactId }), expect: 400, expectError: "Invalid contact" },
  // ── Default Expiry (quote correctness): blank, 0, negative, and fractional are refused ──
  ...(["", null, 0, "0", -5, 2.5] as const).map((value): Attempt => ({
    name: `Default Expiry of ${JSON.stringify(value)}`,
    actor: "admin",
    kind: "refused",
    method: "PATCH",
    path: () => "/api/quote-settings",
    body: () => ({ quoteExpiryDays: value }),
    expect: 400,
    expectError: "Default expiry must be a whole number of days, 1 or more",
  })),
  // ── Template lines (round two, #80): a bad recurring interval is a 400 ──
  { name: "Template line with a made up recurring interval", actor: "templater", kind: "refused", method: "PATCH", path: (c) => `/api/quote-templates/${c.fx.costTemplateId}/line-items/${c.fx.costTemplateLineId}`, body: () => ({ recurringInterval: "WEEKLY" }), expect: 400, expectError: "Invalid recurring interval" },

  // ── Opportunities ──
  // Test Everyone B: refused every opportunity, stage, type, and settings route
  ...OPP_GUARDED.map(refusedFor("everyone")),
  // Test Rep B (Opportunities page and create, no see all, no edit or
  // delete): only its own and unassigned opportunities, only itself or
  // nobody as owner, and no settings writes
  { name: "Open the admin's opportunity", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}`, expect: 404, expectError: "Not found" },
  { name: "The admin's opportunity attachments", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/attachments`, expect: 404, expectError: "Not found" },
  { name: "The admin's opportunity timeline", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/timeline`, expect: 404, expectError: "Not found" },
  { name: "Add a note to own opportunity (no edit)", actor: "rep", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>" }), expect: 403, expectError: "edit opportunities" },
  { name: "The admin's opportunity related records", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/related`, expect: 404, expectError: "Not found" },
  { name: "Create an opportunity owned by the admin", actor: "rep", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: c.b.adminId }), expect: 403, expectError: "You can only assign opportunities to yourself or leave them unassigned" },
  { name: "Edit own opportunity", actor: "rep", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit opportunities" },
  { name: "Delete own opportunity", actor: "rep", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.repOpportunityId}`, expect: 403, expectError: "delete opportunities" },
  ...OPP_GUARDED.filter((g) => g.expectError === OPP_SETTINGS_WRITE).map(refusedFor("rep")),
  {
    name: "Create an opportunity for self (then removed)",
    actor: "rep",
    kind: "allowed",
    method: "POST",
    path: () => "/api/opportunities",
    body: (c) => ({ initialNote: OPP_NOTE, title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: c.repUserId }),
    expect: 200,
    check: createdOpportunityOwnedBy((c) => c.repUserId),
  },
  {
    name: "Create an unassigned opportunity (then removed)",
    actor: "rep",
    kind: "allowed",
    method: "POST",
    path: () => "/api/opportunities",
    body: (c) => ({ initialNote: OPP_NOTE, title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId, ownerId: null }),
    expect: 200,
    check: createdOpportunityOwnedBy(() => null),
  },
  {
    // New records start unassigned when no owner is named
    name: "Create an opportunity without an owner (then removed)",
    actor: "rep",
    kind: "allowed",
    method: "POST",
    path: () => "/api/opportunities",
    body: (c) => ({ initialNote: OPP_NOTE, title: "Dev check opportunity", clientId: c.b.clientId, contactId: c.b.contactId }),
    expect: 200,
    check: createdOpportunityOwnedBy(() => null),
  },
  // A person creating an opportunity must write an initial note, judged
  // after sanitizing
  { name: "Create an opportunity without an initial note", actor: "admin", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 400, expectError: "An initial note is required" },
  { name: "Create an opportunity with an empty initial note", actor: "admin", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: "<p>   </p>", title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 400, expectError: "An initial note is required" },
  { name: "Create an opportunity with a script only initial note", actor: "admin", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: "<script>alert(1)</script>", title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 400, expectError: "An initial note is required" },
  // Test Opp Viewer B (only the Opportunities page): reads, never writes
  { name: "Open the admin's opportunity", actor: "oppViewer", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Create an opportunity", actor: "oppViewer", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 403, expectError: "create opportunities" },
  { name: "Edit an opportunity", actor: "oppViewer", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, body: () => ({ title: "Changed" }), expect: 403, expectError: "edit opportunities" },
  { name: "Delete an opportunity", actor: "oppViewer", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 403, expectError: "delete opportunities" },
  { name: "Upload an opportunity attachment", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments`, expect: 403, expectError: "edit opportunities" },
  { name: "Delete an opportunity attachment", actor: "oppViewer", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/attachments/${c.fx.unassignedOpportunityAttachmentId}`, expect: 403, expectError: "edit opportunities" },
  ...OPP_GUARDED.filter((g) => g.expectError === OPP_SETTINGS_WRITE).map(refusedFor("oppViewer")),
  // Test Opp Settings B (only Opportunity Settings): no opportunities themselves
  { name: "List opportunities", actor: "oppSettings", kind: "refused", method: "GET", path: () => "/api/opportunities", expect: 403, expectError: "view opportunities" },
  { name: "Opportunity timeline", actor: "oppSettings", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, expect: 403, expectError: "view opportunities" },
  { name: "Add an opportunity note", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>" }), expect: 403, expectError: "edit opportunities" },
  { name: "Add a note that changes the stage", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", stageId: c.fx.opportunityStageIds[1] }), expect: 403, expectError: "edit opportunities" },
  // Opportunity details: the client's phone and locations and the contact's
  // details only reach users who may open the opportunity
  { name: "Client details of the admin's opportunity", actor: "rep", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}`, expect: 404, expectError: "Not found" },
  { name: "Client details without the Opportunities page", actor: "oppSettings", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, expect: 403, expectError: "view opportunities" },
  // An opportunity's location must belong to its own client
  { name: "Opportunity location of another client", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, body: (c) => ({ clientLocationId: c.fx.copyClientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Create with a location of another client", actor: "admin", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId, clientLocationId: c.fx.copyClientLocationId }), expect: 400, expectError: "Invalid location" },
  { name: "Change the client with the old client's location", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}`, body: (c) => ({ clientId: c.fx.copyClientId, contactId: c.fx.copyContactId, clientLocationId: c.b.clientLocationId }), expect: 400, expectError: "Invalid location" },
  // A note's stageId is checked like any body id
  { name: "Note with another company's stage", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", stageId: c.c.opportunityStageId }), expect: 400, expectError: "Invalid stage" },
  { name: "Note with a made up stage", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", stageId: c.fakeId }), expect: 400, expectError: "Invalid stage" },
  { name: "Note with a stage that isn't text", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: () => ({ body: "<p>Should not exist</p>", stageId: 42 }), expect: 400, expectError: "Invalid stage" },
  // Timeline notes: only their author edits or deletes them (Global Admin
  // included), and recorded actions never change
  { name: "Edit another user's note", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedRepNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 403, expectError: "your own notes" },
  { name: "Delete another user's note", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedRepNoteId}`, expect: 403, expectError: "your own notes" },
  { name: "Edit an action entry", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedActionId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 403, expectError: "Only notes" },
  { name: "Delete an action entry", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedActionId}`, expect: 403, expectError: "Only notes" },
  { name: "Save own note empty", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, body: () => ({ body: "<p></p>" }), expect: 400, expectError: "can't be empty" },
  { name: "Note under another opportunity", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/opportunities/${c.b.opportunityId}/timeline/${c.fx.unassignedAdminNoteId}`, body: () => ({ body: "<p>Changed</p>" }), expect: 404, expectError: "Not found" },
  { name: "Timeline page with another opportunity's cursor", actor: "admin", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/timeline?cursor=${c.fx.unassignedAdminNoteId}`, expect: 400, expectError: "Invalid cursor" },
  { name: "Opportunity related records", actor: "oppSettings", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/related`, expect: 403, expectError: "view opportunities" },
  { name: "Create an opportunity", actor: "oppSettings", kind: "refused", method: "POST", path: () => "/api/opportunities", body: (c) => ({ initialNote: OPP_NOTE, title: "Should Not Exist", clientId: c.b.clientId, contactId: c.b.contactId }), expect: 403, expectError: "create opportunities" },

  // ── Action buttons ──
  ...ACTION_BUTTON_GUARDED.map(refusedFor("everyone")),
  ...ACTION_BUTTON_GUARDED.map(refusedFor("oppViewer")),
  ...ACTION_BUTTON_GUARDED.map(refusedFor("oppSettings")),
  { name: "Opportunity action buttons", actor: "everyone", kind: "refused", method: "GET", path: () => "/api/action-buttons?for=opportunity", expect: 403, expectError: "view opportunities" },
  {
    name: "Opportunity action buttons (a viewer)",
    actor: "oppViewer",
    kind: "allowed",
    method: "GET",
    path: () => "/api/action-buttons?for=opportunity",
    expect: 200,
    contains: (c) => [c.fx.noteButtonId, c.fx.emailButtonId, c.fx.wonButtonId, c.fx.lostButtonId, c.b.actionButtonId],
  },
  { name: "All action buttons", actor: "admin", kind: "allowed", method: "GET", path: () => "/api/action-buttons", expect: 200, contains: (c) => c.fx.actionButtonIds },
  { name: "Action buttons for an unknown record type", actor: "admin", kind: "refused", method: "GET", path: () => "/api/action-buttons?for=invoice", expect: 400, expectError: "Invalid record type" },
  { name: "Action button with a color that isn't hex", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ color: "red" }), expect: 400, expectError: "Color must be a hex color" },
  { name: "Action button with a fixed stage left out", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ stageMode: "FIXED" }), expect: 400, expectError: "Choose the stage this button moves to" },
  { name: "Action button changing the stage on another kind", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ kind: "RAISE_QUOTE", stageMode: "CHOOSE" }), expect: 400, expectError: "Only Note and Email buttons can change the stage" },
  { name: "Action button with a fixed stage on another kind", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: (c) => buttonBody({ kind: "APPOINTMENT", stageMode: "FIXED", fixedStageId: c.fx.customButtonStageId }), expect: 400, expectError: "Only Note and Email buttons can change the stage" },
  { name: "Action button label over 40 characters", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ label: "x".repeat(41) }), expect: 400, expectError: "40 characters or fewer" },
  { name: "Action button shown nowhere", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ forOpportunities: false, forTickets: false }), expect: 400, expectError: "Choose where the button shows" },
  { name: "Action button with an unknown icon", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: () => buttonBody({ icon: "rocket" }), expect: 400, expectError: "Choose an icon" },
  { name: "Action button losing its fixed stage mode but keeping the stage", actor: "admin", kind: "refused", method: "PATCH", path: (c) => `/api/action-buttons/${c.b.actionButtonId}`, body: () => ({ stageMode: "CHOOSE" }), expect: 400, expectError: "A stage can only be set" },
  { name: "Action button with a made up stage", actor: "admin", kind: "refused", method: "POST", path: () => "/api/action-buttons", body: (c) => buttonBody({ stageMode: "FIXED", fixedStageId: c.fakeId }), expect: 400, expectError: "Invalid stage" },
  { name: "Delete a stage an action button moves to", actor: "admin", kind: "refused", method: "DELETE", path: (c) => `/api/opportunity-stages/${c.fx.customButtonStageId}`, expect: 409, expectError: "action button moves to this stage" },
  // Notes through a button follow its rules on the server
  { name: "Empty note through the Lost button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p></p>", actionButtonId: c.fx.lostButtonId }), expect: 400, expectError: "A note can't be empty" },
  { name: "Empty note through the custom button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ actionButtonId: c.b.actionButtonId }), expect: 400, expectError: "A note can't be empty" },
  { name: "Note through the Won button to another stage", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", actionButtonId: c.fx.wonButtonId, stageId: c.fx.customButtonStageId }), expect: 400, expectError: "always moves to its own stage" },
  { name: "Note through the Email button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", actionButtonId: c.fx.emailButtonId }), expect: 400, expectError: "Invalid action button" },
  { name: "Note through a made up button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", actionButtonId: c.fakeId }), expect: 400, expectError: "Invalid action button" },
  { name: "Note through a button without edit access", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/timeline`, body: (c) => ({ body: "<p>Should not exist</p>", actionButtonId: c.fx.noteButtonId }), expect: 403, expectError: "edit opportunities" },

  // ── The Email action, never with input that could be sent ──
  { name: "Send an opportunity email (no edit)", actor: "oppViewer", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: () => emailBody(), expect: 403, expectError: "edit opportunities" },
  { name: "Opportunity email options (no edit)", actor: "oppViewer", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email-options`, expect: 403, expectError: "edit opportunities" },
  { name: "Opportunity email options", actor: "everyone", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email-options`, expect: 403, expectError: "edit opportunities" },
  { name: "Email from someone else's hidden opportunity", actor: "teamBasic", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.b.opportunityId}/email`, body: () => emailBody(), expect: 404, expectError: "Not found" },
  { name: "Email options of someone else's hidden opportunity", actor: "teamBasic", kind: "refused", method: "GET", path: (c) => `/api/opportunities/${c.b.opportunityId}/email-options`, expect: 404, expectError: "Not found" },
  { name: "Email to an invalid address", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: () => emailBody({ to: ["not-an-address"] }), expect: 400, expectError: "is not a valid email address" },
  { name: "Email with an invalid CC address", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: () => emailBody({ cc: ["nobody@"] }), expect: 400, expectError: "is not a valid email address" },
  { name: "Email to more than 20 recipients", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: () => emailBody({ to: ["a@example.test"], cc: Array.from({ length: 10 }, (_, i) => `cc${i}@example.test`), bcc: Array.from({ length: 10 }, (_, i) => `bcc${i}@example.test`) }), expect: 400, expectError: "at most 20 recipients" },
  { name: "Email with no recipient", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: () => emailBody({ to: [] }), expect: 400, expectError: "Add at least one recipient" },
  { name: "Email with another opportunity's attachment", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: (c) => emailBody({ attachmentIds: [c.fx.repOpportunityAttachmentId] }), expect: 400, expectError: "Invalid attachment" },
  { name: "Email through the Note button", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: (c) => emailBody({ actionButtonId: c.fx.noteButtonId }), expect: 400, expectError: "Invalid action button" },
  { name: "Email through the Email button with a stage", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: (c) => emailBody({ actionButtonId: c.fx.emailButtonId, stageId: c.fx.customButtonStageId }), expect: 400, expectError: "doesn't change the stage" },
  { name: "Email through the Email button with no message", actor: "admin", kind: "refused", method: "POST", path: (c) => `/api/opportunities/${c.fx.unassignedOpportunityId}/email`, body: (c) => emailBody({ actionButtonId: c.fx.emailButtonId, body: "<p></p>" }), expect: 400, expectError: "A message is required" },

  ...TEAM_ATTEMPTS,

  ...AUDIT_ATTEMPTS,

  ...TICKET_ATTEMPTS,

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
    // updatedAt moves on any write to company settings, secrets included
    settings: prisma.companySettings.findUnique({
      where: { companyId: b },
      select: { quoteSendFromMode: true, quoteSendFromConnectionId: true, updatedAt: true },
    }),
    company: prisma.company.findUnique({ where: { id: b }, select: { name: true, logoUrl: true, secondaryLogoUrl: true } }),
    // Every user's own appearance preferences, in both companies
    preferences: prisma.userPreferences.findMany({ where: { user: { companyId: { in: [b, c] } } }, ...byId }),
    salesOrders: prisma.salesOrder.findMany({
      where: { companyId: b },
      ...byId,
      include: { lineItems: byId, comments: byId, attachments: byId },
    }),
    purchaseOrders: prisma.purchaseOrder.findMany({
      where: { companyId: b },
      ...byId,
      include: { lineItems: byId, comments: byId, attachments: byId },
    }),
    approvalWorkflows: prisma.approvalWorkflow.findMany({ where: { companyId: b }, ...byId }),
    distributorIntegrations: prisma.distributorIntegration.findMany({
      where: { companyId: b },
      ...byId,
      select: { id: true, distributor: true, enabled: true, updatedAt: true },
    }),
    dashboards: prisma.dashboard.findMany({ where: { companyId: b }, ...byId, include: { widgets: byId } }),
    roles: prisma.role.findMany({ where: { companyId: b }, ...byId }),
    teams: prisma.team.findMany({ where: { companyId: b }, ...byId, include: { members: byId, defaultRoles: byId } }),
    clients: prisma.client.findMany({
      where: { companyId: b },
      ...byId,
      include: { contacts: { ...byId, include: { tags: true } }, locations: byId },
    }),
    vendors: prisma.vendor.findMany({
      where: { companyId: b },
      ...byId,
      include: { contacts: byId, locations: byId },
    }),
    vendorAttachments: prisma.vendorAttachment.findMany({ where: { vendor: { companyId: b } }, ...byId }),
    catalogItems: prisma.catalogItem.findMany({ where: { companyId: b }, ...byId }),
    catalogChangeLogs: prisma.catalogItemChangeLog.count({ where: { catalogItem: { companyId: b } } }),
    categories: prisma.category.findMany({ where: { companyId: b }, ...byId }),
    customFields: prisma.inventoryCustomField.findMany({ where: { companyId: b }, ...byId }),
    industries: prisma.industry.findMany({ where: { companyId: b }, ...byId }),
    contactTags: prisma.contactTag.findMany({ where: { companyId: b }, ...byId }),
    inventoryAssets: prisma.inventoryAsset.findMany({ where: { companyId: b }, ...byId }),
    assetAttachments: prisma.inventoryAssetAttachment.findMany({ where: { asset: { companyId: b } }, ...byId }),
    assetEvents: prisma.inventoryAssetEvent.count({ where: { asset: { companyId: b } } }),
    containers: prisma.inventoryLocation.findMany({ where: { companyId: b }, ...byId }),
    stock: prisma.inventoryStock.findMany({ where: { companyId: b }, ...byId }),
    stockEvents: prisma.inventoryStockEvent.count({ where: { stock: { companyId: b } } }),
    users: prisma.user.findMany({
      where: { companyId: b },
      ...byId,
      select: { id: true, name: true, active: true, roleId: true, loginLockedUntil: true },
    }),
    notifications: prisma.notification.count({ where: { companyId: b } }),
    opportunities: prisma.opportunity.findMany({ where: { companyId: b }, ...byId, include: { attachments: byId, timeline: byId } }),
    opportunityStages: prisma.opportunityStage.findMany({ where: { companyId: b }, ...byId }),
    opportunityTypes: prisma.opportunityType.findMany({ where: { companyId: b }, ...byId }),
    opportunitySettings: prisma.opportunitySettings.findUnique({ where: { companyId: b } }),
    actionButtons: prisma.actionButton.findMany({ where: { companyId: b }, ...byId }),
    auditLogEntries: prisma.auditLogEntry.findMany({ where: { companyId: b }, ...byId }),
    tickets: prisma.ticket.findMany({ where: { companyId: b }, ...byId, include: { attachments: byId, timeline: byId } }),
    ticketTypes: prisma.ticketType.findMany({ where: { companyId: b }, ...byId }),
    ticketPriorities: prisma.ticketPriority.findMany({ where: { companyId: b }, ...byId }),
    ticketStatuses: prisma.ticketStatus.findMany({ where: { companyId: b }, ...byId }),
    ticketSettings: prisma.ticketSettings.findUnique({ where: { companyId: b } }),
  }
  const keys = Object.keys(sections) as (keyof typeof sections)[]
  const values = await Promise.all(keys.map((k) => sections[k]))
  return Object.fromEntries(keys.map((k, i) => [k, JSON.stringify(values[i])]))
}

function changedSections(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(after).filter((k) => before[k] !== after[k])
}

// Test Sender B inside Test Company B, made for this run, with its own
// mailbox row (placeholder tokens). The password exists only in memory for
// this run.
async function ensureSenderFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const senderPermissions = { pages: { quotes: true }, quotes: { sendEmail: true, viewAllUsersQuotes: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.senderRole, rank: 6, permissions: senderPermissions })
  const userId = await addRunUser(prisma, run, { companyId, name: n.senderName, email: n.senderEmail, roleIds: [roleId] })
  const mailboxId = await addRunMailbox(prisma, run, { companyId, email: n.senderMailboxEmail, label: n.senderName, connectedByUserId: userId })

  return { email: n.senderEmail, mailboxId }
}

// Test Viewer B inside Test Company B: both order pages and both viewAll
// keys, no edit, so it opens every order without seeing cost. Made for this
// run, password in memory only.
async function ensureViewerFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const viewerPermissions = {
    pages: { salesOrders: true, purchaseOrders: true },
    salesOrders: { viewAll: true },
    purchaseOrders: { viewAll: true },
  }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.viewerRole, rank: 1, permissions: viewerPermissions })
  await addRunUser(prisma, run, { companyId, name: n.viewerName, email: n.viewerEmail, roleIds: [roleId] })

  return { email: n.viewerEmail }
}

// Test Audit Viewer B inside Test Company B: reads the audit log and every
// opportunity, and opens Settings, but can't undo or restore. Made for this
// run, password in memory only.
async function ensureAuditViewerFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const permissions = { pages: { opportunities: true, settings: true }, opportunities: { viewAll: true }, auditLog: { view: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.auditViewerRole, rank: 2, permissions })
  await addRunUser(prisma, run, { companyId, name: n.auditViewerName, email: n.auditViewerEmail, roleIds: [roleId] })

  return { email: n.auditViewerEmail }
}

// Test Manager B inside Test Company B: manages users (Manage Users) but
// is not a Global Admin, for the invite rank rule. It also opens the
// Settings page (no API route reads pages.settings), so the page checks
// see a Settings user without Opportunity Settings. Made for this run,
// password in memory only.
async function ensureManagerFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const managerPermissions = { pages: { settings: true }, settingsSections: { users: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.managerRole, rank: 5, permissions: managerPermissions })
  await addRunUser(prisma, run, { companyId, name: n.managerName, email: n.managerEmail, roleIds: [roleId] })

  return { email: n.managerEmail, roleId }
}

// An ad hoc line (no catalog item, so not inventory tracked) on Test
// Orders B's purchase order, not yet received. Removed at the end of the run.
async function ensureUntrackedPoLine(prisma: PrismaClient, fx: PermissionFixtureIds, names: TestNames) {
  const name = names.untrackedPoLine
  const existing = await prisma.pOLineItem.findFirst({ where: { purchaseOrderId: fx.ordersPurchaseOrderId, name }, select: { id: true } })
  if (existing) {
    await prisma.pOLineItem.update({ where: { id: existing.id }, data: { received: false, catalogItemId: null } })
    return existing.id
  }
  const created = await prisma.pOLineItem.create({
    data: { purchaseOrderId: fx.ordersPurchaseOrderId, name, quantity: 1, unitCost: 1, received: false },
    select: { id: true },
  })
  return created.id
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

// Test Approver B inside Test Company B: the Quotes page and approving,
// not a Global Admin, so it decides an approval it didn't request. Made for
// this run, password in memory only.
async function ensureApproverFixture(prisma: PrismaClient, run: RunData) {
  const n = run.companies.B.names
  const companyId = run.companies.B.ids.companyId
  const approverPermissions = { pages: { quotes: true }, quotes: { approve: true } }

  const roleId = await addRunRole(prisma, run, { companyId, name: n.approverRole, rank: 7, permissions: approverPermissions })
  await addRunUser(prisma, run, { companyId, name: n.approverName, email: n.approverEmail, roleIds: [roleId] })

  return { email: n.approverEmail, roleId }
}

// The quote fields the round two steps below change, for every version of
// Test Company B's sample quote, so each step can put them back exactly
const SAMPLE_QUOTE_FIELDS = {
  id: true,
  status: true,
  sentAt: true,
  viewedAt: true,
  acceptedAt: true,
  declinedAt: true,
  isActive: true,
  terms: true,
  useDefaultTerms: true,
  internalNotes: true,
  pendingEmailPayload: true,
  opportunityId: true,
} as const

// Also takes the company's opportunity ids: sending or accepting the quote
// makes the app create an opportunity for it, which the restore removes
async function saveSampleQuote(prisma: PrismaClient, quoteId: string) {
  const q = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { companyId: true, quoteNumber: true } })
  const quotes = await prisma.quote.findMany({ where: { companyId: q.companyId, quoteNumber: q.quoteNumber }, select: SAMPLE_QUOTE_FIELDS })
  return { companyId: q.companyId, quotes, opportunityIds: await opportunityIdsOf(prisma, [q.companyId]) }
}

async function restoreSampleQuote(prisma: PrismaClient, saved: Awaited<ReturnType<typeof saveSampleQuote>>) {
  for (const { id, pendingEmailPayload, ...fields } of saved.quotes) {
    await prisma.quote.update({
      where: { id },
      data: { ...fields, pendingEmailPayload: pendingEmailPayload === null ? Prisma.DbNull : (pendingEmailPayload as Prisma.InputJsonValue) },
    })
  }
  await removeOpportunitiesAddedSince(prisma, [saved.companyId], saved.opportunityIds)
}

// Round two, N-1: changing a draft quote's status by hand runs the same
// approval workflow check as Send Quote. Runs as Test Admin B (who holds
// quotes.changeStatus) on its own sample quote, with the sample workflow
// switched on and then off, and puts everything back.
async function checkStatusApproval(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const quoteId = ctx.b.quoteId
  const workflowId = ctx.b.workflowId
  const label = (name: string) => `[Admin B] Status needs approval: ${name}`
  const row = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const status = (s: string) => admin.request("POST", `/api/quotes/${quoteId}/status`, { json: { status: s } })
  const current = async () => (await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })).status

  const workflow = await prisma.approvalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  const saved = await saveSampleQuote(prisma, quoteId)
  const salesOrdersBefore = await prisma.salesOrder.count({ where: { quoteId } })
  try {
    // Every quote of the company now needs approval
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: true, triggerType: "TOTAL_THRESHOLD", thresholdValue: 0, triggerUserId: null },
    })
    for (const target of ["SENT", "ACCEPTED"]) {
      const res = await status(target)
      const now = await current()
      const ok = res.status === 400 && errorText(res.text).includes("needs approval before it can be changed") && now === "DRAFT"
      row(`${target} with an active workflow is refused`, '400 "needs approval", still DRAFT', `${res.status}, ${now}`, ok ? null : errorText(res.text))
    }
    const madeSalesOrder = (await prisma.salesOrder.count({ where: { quoteId } })) !== salesOrdersBefore
    row("refused ACCEPTED made no sales order", "no new sales order", madeSalesOrder ? "a sales order" : "none", madeSalesOrder ? "a sales order was created" : null)

    const declined = await status("DECLINED")
    const afterDecline = await current()
    row("DECLINED is always allowed", "200, DECLINED", `${declined.status}, ${afterDecline}`, declined.status === 200 && afterDecline === "DECLINED" ? null : errorText(declined.text))
    await restoreSampleQuote(prisma, saved)

    // With the workflow off, the same change goes through as before
    await prisma.approvalWorkflow.update({ where: { id: workflowId }, data: { active: false } })
    const sent = await status("SENT")
    const afterSend = await current()
    row("SENT with the workflow off is allowed", "200, SENT", `${sent.status}, ${afterSend}`, sent.status === 200 && afterSend === "SENT" ? null : errorText(sent.text))
  } finally {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: workflow.active, triggerType: workflow.triggerType, thresholdValue: workflow.thresholdValue, triggerUserId: workflow.triggerUserId },
    })
    await restoreSampleQuote(prisma, saved)
  }
}

// Round two, N-2: a quote changed after approval was requested is not sent
// when the approval comes in. Test Admin B requests approval with an email
// (it can't go out: the test company has no Microsoft credentials), changes
// a line price through the API, and Test Approver B approves. Everything is
// put back, the notification it makes included.
async function checkStaleApproval(
  prisma: PrismaClient,
  admin: Session,
  approver: Session,
  approverRoleId: string,
  ctx: AttemptContext,
  rows: Row[]
) {
  const quoteId = ctx.b.quoteId
  const workflowId = ctx.b.workflowId
  const lineId = ctx.b.quoteLineId
  const label = (name: string) => `[Admin B, Approver B] Stale approval: ${name}`
  const row = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })

  const workflow = await prisma.approvalWorkflow.findUniqueOrThrow({ where: { id: workflowId } })
  const line = await prisma.quoteLineItem.findUniqueOrThrow({ where: { id: lineId }, select: { unitPrice: true } })
  const saved = await saveSampleQuote(prisma, quoteId)
  const startedAt = new Date()
  try {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: { active: true, triggerType: "TOTAL_THRESHOLD", thresholdValue: 0, triggerUserId: null, requiredRoleId: approverRoleId },
    })
    const send = await admin.request("POST", `/api/quotes/${quoteId}/send-email`, { json: sendBody() })
    const held = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })
    const heldOk = send.status === 200 && held.status === "PENDING_APPROVAL"
    row("send is held for approval", "200, PENDING_APPROVAL", `${send.status}, ${held.status}`, heldOk ? null : errorText(send.text))
    if (!heldOk) return

    const edit = await admin.request("PATCH", `/api/quotes/${quoteId}/line-items/${lineId}`, { json: { unitPrice: line.unitPrice + 1 } })
    row("owner changes a line price while pending", "200", String(edit.status), edit.status === 200 ? null : errorText(edit.text))

    const approval = await prisma.quoteApproval.findFirst({ where: { quoteId, workflowId, status: "PENDING" }, select: { id: true } })
    if (!approval) {
      row("approval was requested", "a pending approval", "none", "no pending approval was created")
      return
    }
    const approve = await approver.request("POST", `/api/quotes/${quoteId}/approvals/${approval.id}/approve`)
    let body: { warning?: string; stale?: boolean } = {}
    try {
      body = JSON.parse(approve.text)
    } catch {
      // reported below
    }
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, sentAt: true, pendingEmailPayload: true } })
    const kept = after.pendingEmailPayload as { to?: string; approvalStale?: boolean; approvedFingerprint?: string } | null
    const notified = await prisma.notification.count({ where: { link: `/dashboard/quotes/${quoteId}`, createdAt: { gte: startedAt } } })
    const problem =
      approve.status !== 200
        ? `approve returned ${approve.status}: ${errorText(approve.text)}`
        : !body.stale || !body.warning?.includes("changed after approval was requested")
          ? "no stale warning in the response"
          : after.status !== "DRAFT" || after.sentAt
            ? `quote is ${after.status}${after.sentAt ? " and was marked sent" : ""}`
            : !kept?.to
              ? "the held email was not kept"
              : !kept.approvalStale || kept.approvedFingerprint
                ? "the approvals still count"
                : notified === 0
                  ? "the owner was not notified"
                  : null
    row("approving a changed quote does not send it", "200 stale warning, DRAFT, email kept, owner notified", `${approve.status}, ${after.status}`, problem)
  } finally {
    await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: {
        active: workflow.active,
        triggerType: workflow.triggerType,
        thresholdValue: workflow.thresholdValue,
        triggerUserId: workflow.triggerUserId,
        requiredRoleId: workflow.requiredRoleId,
      },
    })
    await prisma.quoteLineItem.update({ where: { id: lineId }, data: { unitPrice: line.unitPrice } })
    await prisma.quoteApproval.deleteMany({ where: { quoteId } })
    await prisma.notification.deleteMany({ where: { link: `/dashboard/quotes/${quoteId}`, createdAt: { gte: startedAt } } })
    await restoreSampleQuote(prisma, saved)
  }
}

// Round two, #56: a sales order lists only the linked purchase orders the
// user may open. Test Company B's second sample purchase order (owned by
// Test Admin B) is linked to Test Orders B's sales order for the step and
// unlinked afterwards.
async function checkSalesOrderLinkedPurchaseOrders(prisma: PrismaClient, admin: Session, orders: Session, ctx: AttemptContext, rows: Row[]) {
  const poId = ctx.b.purchaseOrder2Id
  const soId = ctx.fx.ordersSalesOrderId
  const label = (who: string, name: string) => `[${who}] Linked purchase orders: ${name}`
  const original = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { salesOrderId: true } })
  try {
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { salesOrderId: soId } })

    const asOrders = await orders.request("GET", `/api/sales-orders/${soId}`)
    let count = -1
    try {
      count = (JSON.parse(asOrders.text) as { _count?: { purchaseOrders?: number } })._count?.purchaseOrders ?? -1
    } catch {
      // reported below
    }
    const ordersProblem =
      asOrders.status !== 200
        ? `got ${asOrders.status}: ${errorText(asOrders.text)}`
        : asOrders.text.includes(poId)
          ? "the admin's purchase order is in the response"
          : count < 1
            ? "the linked purchase order count is missing"
            : null
    rows.push({
      attempt: label("Orders B", "another user's purchase order is not shown"),
      expected: "200 without the admin's purchase order",
      actual: String(asOrders.status),
      result: ordersProblem ? "FAIL" : "PASS",
      note: ordersProblem ?? undefined,
    })

    const asAdmin = await admin.request("GET", `/api/sales-orders/${soId}`)
    const adminProblem = asAdmin.status !== 200 ? `got ${asAdmin.status}` : !asAdmin.text.includes(poId) ? "the purchase order is missing" : null
    rows.push({
      attempt: label("Admin B", "Global Admin still sees it"),
      expected: "200 with the purchase order",
      actual: String(asAdmin.status),
      result: adminProblem ? "FAIL" : "PASS",
      note: adminProblem ?? undefined,
    })
  } finally {
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { salesOrderId: original.salesOrderId } })
  }
}

// Page guards for the Opportunities screens. Pages answer 200 either way,
// so each one is read as HTML with the user's session: a refused page holds
// the NoAccess text (rendered on the server), an allowed one doesn't. The
// Settings page lists only the sections a user may use, so Opportunity
// Settings is allowed when its entry is listed. (Its ?panel= link is applied
// in the browser, so the server's HTML shows the first listed section.)
const NO_ACCESS_PAGE = "You do not have access to this page"
const OPP_SETTINGS_ENTRY = "Opportunity Settings"
// The Teams entry's text right after its icon, so the word elsewhere on the page doesn't count
const TEAMS_ENTRY = ">Teams<"

async function checkOpportunityPages(sessions: Record<Actor, Session>, labels: Record<Actor, string>, ctx: AttemptContext, rows: Row[]) {
  // settings: the text of the section's entry in the Settings list, which
  // must be listed for the section to count as open
  const pages: { name: string; path: string; allowed: Actor[]; refused: Actor[]; settings?: string }[] = [
    { name: "Opportunities page", path: "/dashboard/opportunities?view=list", allowed: ["admin", "rep", "oppViewer"], refused: ["everyone", "oppSettings", "clerk"] },
    {
      name: "Opportunity page",
      path: `/dashboard/opportunities/${ctx.fx.unassignedOpportunityId}`,
      allowed: ["admin", "rep", "oppViewer"],
      refused: ["everyone", "oppSettings", "clerk"],
    },
    // Test Manager B opens Settings without Opportunity Settings
    { name: "Settings > Opportunity Settings", path: "/dashboard/settings?panel=opportunities", allowed: ["admin", "oppSettings"], refused: ["everyone", "manager", "oppViewer"], settings: OPP_SETTINGS_ENTRY },
    // Test Manager B (Users) and Test Opp Settings B open Settings without Teams
    { name: "Settings > Teams", path: "/dashboard/settings?panel=teams", allowed: ["admin", "teamManager"], refused: ["everyone", "manager", "oppSettings"], settings: TEAMS_ENTRY },
  ]
  for (const page of pages) {
    for (const [actor, allowed] of [...page.allowed.map((a) => [a, true] as const), ...page.refused.map((a) => [a, false] as const)]) {
      const res = await sessions[actor].request("GET", page.path)
      const pageRefused = res.text.includes(NO_ACCESS_PAGE)
      const opens = !pageRefused && (!page.settings || res.text.includes(page.settings))
      const problem =
        res.status !== 200
          ? `got ${res.status}${res.location ? ` to ${res.location}` : ""}`
          : allowed && !opens
            ? pageRefused
              ? "the page shows no access"
              : "the section is not listed in Settings"
            : !allowed && opens
              ? "the page opened"
              : null
      rows.push({
        attempt: `[${labels[actor]}] ${page.name}`,
        expected: allowed ? "200, opens" : "200, no access",
        actual: res.status === 200 ? (opens ? "200, opens" : "200, no access") : String(res.status),
        result: problem ? "FAIL" : "PASS",
        note: problem ?? undefined,
      })
    }
  }
}

// The Related panel lists only what the user may open. The admin's sample
// quote and Test Rep B's quote are linked to the unassigned sample
// opportunity for the step and unlinked afterwards. Test Admin B (Global
// Admin) sees both, Test Rep B (own quotes only) only its own, and Test
// Opp Viewer B (no Quotes page) neither.
async function checkRelatedVisibility(prisma: PrismaClient, sessions: Record<Actor, Session>, labels: Record<Actor, string>, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const adminQuoteId = ctx.b.quoteId
  const repQuoteId = ctx.fx.repQuoteId
  const original = await prisma.quote.findMany({ where: { id: { in: [adminQuoteId, repQuoteId] } }, select: { id: true, opportunityId: true } })
  try {
    await prisma.quote.updateMany({ where: { id: { in: [adminQuoteId, repQuoteId] } }, data: { opportunityId } })

    const cases: { actor: Actor; sees: string[]; hidden: string[] }[] = [
      { actor: "admin", sees: [adminQuoteId, repQuoteId], hidden: [] },
      { actor: "rep", sees: [repQuoteId], hidden: [adminQuoteId] },
      { actor: "oppViewer", sees: [], hidden: [adminQuoteId, repQuoteId] },
    ]
    for (const c of cases) {
      const res = await sessions[c.actor].request("GET", `/api/opportunities/${opportunityId}/related`)
      let quoteIds: string[] | null = null
      try {
        quoteIds = ((JSON.parse(res.text) as { quotes?: { id: string }[] }).quotes ?? []).map((q) => q.id)
      } catch {
        // reported below
      }
      const missing = c.sees.filter((id) => !quoteIds?.includes(id))
      const leaked = c.hidden.filter((id) => res.text.includes(id))
      const problem =
        res.status !== 200
          ? `got ${res.status}: ${errorText(res.text)}`
          : quoteIds === null
            ? "no quotes list in the response"
            : leaked.length > 0
              ? `shows a quote the user may not open (${leaked.join(", ")})`
              : missing.length > 0
                ? `missing a linked quote the user may open (${missing.join(", ")})`
                : null
      rows.push({
        attempt: `[${labels[c.actor]}] Related panel lists only quotes it may open`,
        expected: `200 with ${c.sees.length} linked quote${c.sees.length === 1 ? "" : "s"}`,
        actual: String(res.status),
        result: problem ? "FAIL" : "PASS",
        note: problem ?? undefined,
      })
    }
  } finally {
    for (const q of original) await prisma.quote.update({ where: { id: q.id }, data: { opportunityId: q.opportunityId } })
  }
}

// A stage's category change sets or clears closedAt on its opportunities.
// Test Opp Settings B moves the company's first stage (New, OPEN, where
// all three sample opportunities sit, and not the quote sent stage) to WON
// and back. The stage and every closedAt are put back afterwards.
async function checkStageCategoryClosedAt(prisma: PrismaClient, oppSettings: Session, ctx: AttemptContext, rows: Row[]) {
  const stageId = ctx.fx.opportunityStageIds[0]
  const label = (name: string) => `[Opp Settings B] Stage category change: ${name}`
  const stage = await prisma.opportunityStage.findUniqueOrThrow({ where: { id: stageId }, select: { category: true } })
  const settings = await prisma.opportunitySettings.findUniqueOrThrow({ where: { companyId: ctx.b.companyId }, select: { quoteSentStageId: true } })
  const original = await prisma.opportunity.findMany({ where: { companyId: ctx.b.companyId, stageId }, select: { id: true, closedAt: true } })
  if (stage.category !== "OPEN" || settings.quoteSentStageId === stageId || original.length === 0) {
    rows.push({ attempt: label("fixture"), expected: "an OPEN stage with opportunities", actual: stage.category, result: "UNEXPECTED", note: "the first stage isn't as the run data set it up" })
    return
  }
  const ids = original.map((o) => o.id)
  try {
    const toWon = await oppSettings.request("PATCH", `/api/opportunity-stages/${stageId}`, { json: { category: "WON" } })
    const closed = await prisma.opportunity.findMany({ where: { id: { in: ids } }, select: { closedAt: true } })
    const wonProblem =
      toWon.status !== 200 ? `got ${toWon.status}: ${errorText(toWon.text)}` : closed.some((o) => o.closedAt === null) ? "an opportunity in the stage has no closedAt" : null
    rows.push({ attempt: label("OPEN to WON sets closedAt"), expected: `200, ${ids.length} closed`, actual: String(toWon.status), result: wonProblem ? "FAIL" : "PASS", note: wonProblem ?? undefined })

    const toOpen = await oppSettings.request("PATCH", `/api/opportunity-stages/${stageId}`, { json: { category: "OPEN" } })
    const reopened = await prisma.opportunity.findMany({ where: { id: { in: ids } }, select: { closedAt: true } })
    const openProblem =
      toOpen.status !== 200 ? `got ${toOpen.status}: ${errorText(toOpen.text)}` : reopened.some((o) => o.closedAt !== null) ? "an opportunity in the stage still has a closedAt" : null
    rows.push({ attempt: label("WON back to OPEN clears closedAt"), expected: `200, ${ids.length} open`, actual: String(toOpen.status), result: openProblem ? "FAIL" : "PASS", note: openProblem ?? undefined })
  } finally {
    await prisma.opportunityStage.update({ where: { id: stageId }, data: { category: "OPEN" } })
    for (const o of original) await prisma.opportunity.update({ where: { id: o.id }, data: { closedAt: o.closedAt } })
  }
}

// The opportunity timeline, on the unassigned sample opportunity as Test
// Admin B: a note holding a script tag is stored and returned without it,
// its author edits it (editedAt set) and deletes it, a stage change through
// PATCH adds exactly one stage_changed entry, and a PATCH that changes
// nothing adds none. The stage, its dates, and every entry the step added
// are put back afterwards.
async function checkTimeline(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const base = `/api/opportunities/${opportunityId}`
  const label = (name: string) => `[Admin B] Timeline: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const startedAt = new Date()
  const original = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, stageChangedAt: true, closedAt: true, title: true } })
  const otherStageId = ctx.fx.opportunityStageIds.find((s) => s !== original.stageId)
  const count = (where: Prisma.TimelineEntryWhereInput = {}) => prisma.timelineEntry.count({ where: { opportunityId, ...where } })
  let noteId: string | null = null
  try {
    // A script tag is stripped on save and on the way out, the text kept
    const add = await admin.request("POST", `${base}/timeline`, { json: { body: "<p>Dev check note</p><script>window.devCheck = 1</script>" } })
    noteId = add.status === 200 ? ((JSON.parse(add.text) as { id?: string }).id ?? null) : null
    const stored = noteId ? await prisma.timelineEntry.findUnique({ where: { id: noteId }, select: { body: true, kind: true, authorId: true } }) : null
    push(
      "a note with a script tag is saved without it",
      "200, no script stored or returned",
      String(add.status),
      add.status !== 200 || !stored
        ? `got ${add.status}: ${errorText(add.text)}`
        : /<script/i.test(stored.body ?? "") || /<script/i.test(add.text)
          ? "the script tag was kept"
          : !(stored.body ?? "").includes("Dev check note")
            ? "the note text was lost"
            : stored.kind !== "NOTE" || stored.authorId !== ctx.b.adminId
              ? "not saved as the admin's note"
              : null
    )
    if (!noteId) return

    const listed = await admin.request("GET", `${base}/timeline`)
    push("the timeline returns it first, without the script", "200, the new note first", String(listed.status),
      listed.status !== 200 ? `got ${listed.status}` : /<script/i.test(listed.text) ? "a script tag was returned" : (JSON.parse(listed.text) as { entries: { id: string }[] }).entries[0]?.id !== noteId ? "the new note is not first" : null)

    const edit = await admin.request("PATCH", `${base}/timeline/${noteId}`, { json: { body: "<p>Dev check note, edited</p>" } })
    const edited = await prisma.timelineEntry.findUnique({ where: { id: noteId }, select: { body: true, editedAt: true } })
    push("its author edits it", "200, editedAt set", String(edit.status),
      edit.status !== 200 ? `got ${edit.status}: ${errorText(edit.text)}` : !edited?.editedAt || !edited.body?.includes("edited") ? "the edit was not saved" : null)

    const del = await admin.request("DELETE", `${base}/timeline/${noteId}`)
    const gone = (await prisma.timelineEntry.count({ where: { id: noteId } })) === 0
    push("its author deletes it", "200, gone", String(del.status), del.status !== 200 ? `got ${del.status}: ${errorText(del.text)}` : !gone ? "the note is still there" : null)
    if (gone) noteId = null

    if (otherStageId) {
      const beforeAll = await count()
      const beforeStage = await count({ action: "stage_changed" })
      const move = await admin.request("PATCH", base, { json: { stageId: otherStageId } })
      const addedAll = (await count()) - beforeAll
      const addedStage = (await count({ action: "stage_changed" })) - beforeStage
      push("a stage change adds one stage_changed entry", "200, exactly 1 entry", `${move.status}, ${addedAll} added`,
        move.status !== 200 ? `got ${move.status}: ${errorText(move.text)}` : addedAll !== 1 || addedStage !== 1 ? `added ${addedAll} entries, ${addedStage} stage_changed` : null)
    }

    const beforeSame = await count()
    const same = await admin.request("PATCH", base, { json: { title: original.title } })
    const addedSame = (await count()) - beforeSame
    push("a PATCH that changes nothing adds none", "200, 0 entries", `${same.status}, ${addedSame} added`,
      same.status !== 200 ? `got ${same.status}: ${errorText(same.text)}` : addedSame !== 0 ? `added ${addedSame} entries` : null)
  } finally {
    if (noteId) await prisma.timelineEntry.deleteMany({ where: { id: noteId } })
    await prisma.timelineEntry.deleteMany({ where: { opportunityId, kind: "ACTION", createdAt: { gte: startedAt } } })
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { stageId: original.stageId, stageChangedAt: original.stageChangedAt, closedAt: original.closedAt } })
  }
}

// A note posted with a stageId moves the unassigned sample opportunity:
// to a WON stage (closedAt set), then back to an OPEN one (closedAt
// cleared), each adding exactly one entry, the NOTE, which holds the move.
// The stage, its dates, and the notes are put back afterwards.
async function checkNoteStageChange(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const label = (name: string) => `[Admin B] Note with a stage change: ${name}`
  const startedAt = new Date()
  const original = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, stageChangedAt: true, closedAt: true } })
  const won = await prisma.opportunityStage.findFirst({ where: { companyId: ctx.b.companyId, category: "WON" }, select: { id: true } })
  const open = await prisma.opportunityStage.findFirst({ where: { companyId: ctx.b.companyId, category: "OPEN", id: { not: original.stageId } }, select: { id: true } })
  if (!won || !open) {
    rows.push({ attempt: label("fixture"), expected: "a WON and another OPEN stage", actual: "missing", result: "UNEXPECTED", note: "the run data's stages aren't as set up" })
    return
  }
  try {
    for (const step of [
      { name: "to WON sets closedAt", stageId: won.id, closed: true },
      { name: "back to OPEN clears closedAt", stageId: open.id, closed: false },
    ]) {
      const before = await prisma.timelineEntry.count({ where: { opportunityId } })
      const res = await admin.request("POST", `/api/opportunities/${opportunityId}/timeline`, { json: { body: `<p>Dev check stage note</p>`, stageId: step.stageId } })
      const after = await prisma.timelineEntry.findMany({ where: { opportunityId, createdAt: { gte: startedAt } }, orderBy: { createdAt: "desc" }, select: { kind: true, data: true } })
      const added = (await prisma.timelineEntry.count({ where: { opportunityId } })) - before
      const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, closedAt: true } })
      const change = (after[0]?.data as { stageChange?: { to?: { id?: string } } } | null)?.stageChange
      const problem =
        res.status !== 200
          ? `got ${res.status}: ${errorText(res.text)}`
          : opp.stageId !== step.stageId
            ? "the stage did not change"
            : step.closed !== (opp.closedAt !== null)
              ? step.closed
                ? "closedAt was not set"
                : "closedAt was not cleared"
              : added !== 1
                ? `added ${added} entries, expected 1`
                : after[0]?.kind !== "NOTE" || change?.to?.id !== step.stageId
                  ? "the note doesn't hold the stage change"
                  : null
      rows.push({ attempt: label(step.name), expected: "200, stage moved, 1 entry", actual: `${res.status}, ${added} added`, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
    }
  } finally {
    await prisma.timelineEntry.deleteMany({ where: { opportunityId, createdAt: { gte: startedAt } } })
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { stageId: original.stageId, stageChangedAt: original.stageChangedAt, closedAt: original.closedAt } })
  }
}

// Opportunity locations, as Test Admin B: a create without a location saves
// the client's main location (the created row is removed right after), a
// PATCH to the client's second location adds exactly one location_changed
// entry and saving it again adds none, and changing the client (no location
// given) resets it to the new client's main location. The unassigned sample
// opportunity's client, contact, location, and the entries the step added
// are put back afterwards.
async function checkOpportunityLocation(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const base = `/api/opportunities/${opportunityId}`
  const label = (name: string) => `[Admin B] Opportunity location: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const locationOf = (text: string) => {
    try {
      return (JSON.parse(text) as { clientLocation?: { id?: string } | null }).clientLocation?.id ?? null
    } catch {
      return null
    }
  }
  const startedAt = new Date()
  const original = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { clientId: true, contactId: true, clientLocationId: true } })
  const count = (action?: string) => prisma.timelineEntry.count({ where: { opportunityId, ...(action ? { action } : {}) } })
  let createdId: string | null = null
  try {
    const create = await admin.request("POST", "/api/opportunities", { json: { initialNote: OPP_NOTE, title: "Dev check location", clientId: ctx.b.clientId, contactId: ctx.b.contactId } })
    try {
      createdId = (JSON.parse(create.text) as { id?: string }).id ?? null
    } catch {
      // reported below
    }
    push("a create without one saves the main location", "200, the main location", String(create.status),
      create.status !== 200 ? `got ${create.status}: ${errorText(create.text)}` : locationOf(create.text) !== ctx.b.clientLocationId ? `saved ${locationOf(create.text) ?? "none"}` : null)

    const beforeAll = await count()
    const beforeLocation = await count("location_changed")
    const second = await admin.request("PATCH", base, { json: { clientLocationId: ctx.fx.clientLocation2Id } })
    const addedAll = (await count()) - beforeAll
    const addedLocation = (await count("location_changed")) - beforeLocation
    push("another of the client's locations saves with one entry", "200, 1 location_changed", `${second.status}, ${addedAll} added`,
      second.status !== 200
        ? `got ${second.status}: ${errorText(second.text)}`
        : locationOf(second.text) !== ctx.fx.clientLocation2Id
          ? "the location did not change"
          : addedAll !== 1 || addedLocation !== 1
            ? `added ${addedAll} entries, ${addedLocation} location_changed`
            : null)

    const beforeSame = await count()
    const same = await admin.request("PATCH", base, { json: { clientLocationId: ctx.fx.clientLocation2Id } })
    const addedSame = (await count()) - beforeSame
    push("the same location again adds no entry", "200, 0 entries", `${same.status}, ${addedSame} added`,
      same.status !== 200 ? `got ${same.status}: ${errorText(same.text)}` : addedSame !== 0 ? `added ${addedSame} entries` : null)

    const move = await admin.request("PATCH", base, { json: { clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId } })
    push("a new client resets it to that client's main location", "200, the new client's main location", String(move.status),
      move.status !== 200 ? `got ${move.status}: ${errorText(move.text)}` : locationOf(move.text) !== ctx.fx.copyClientLocationId ? `saved ${locationOf(move.text) ?? "none"}` : null)
  } finally {
    if (createdId) await prisma.opportunity.deleteMany({ where: { id: createdId } })
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { clientId: original.clientId, contactId: original.contactId, clientLocationId: original.clientLocationId } })
    await prisma.timelineEntry.deleteMany({ where: { opportunityId, createdAt: { gte: startedAt } } })
  }
}

// Team default roles apply on the next request, with nothing copied into
// the user's own roles. Test Everyone B (no permissions) is added to Sales
// through the members route and can then open the sample catalog item
// (Team Grant gives the Catalog page), loses it when removed, and keeps it
// when Team Grant is also given directly. Test Admin B makes the changes;
// Test Everyone B's roles and Sales' members are put back afterwards.
async function checkTeamDefaultRoles(prisma: PrismaClient, admin: Session, everyone: Session, ctx: AttemptContext, rows: Row[]) {
  const salesId = ctx.b.salesTeamId
  const userId = ctx.fx.everyoneUserId
  const catalogPath = `/api/catalog/${ctx.b.catalogItemId}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[Everyone B] Team default roles: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const originalMembers = (await prisma.teamMember.findMany({ where: { teamId: salesId }, select: { userId: true } })).map((m) => m.userId)
  const originalRoles = (await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } })).map((r) => r.roleId)
  const opens = async () => (await everyone.request("GET", catalogPath)).status
  const setMembers = (userIds: string[]) => admin.request("PUT", `/api/teams/${salesId}/members`, { json: { userIds } })
  try {
    const before = await opens()
    push("without the team", "403", String(before), before !== 403 ? `got ${before}` : null)

    const joined = await setMembers([...originalMembers, userId])
    const afterJoin = await opens()
    push("gains the role on joining", "200", String(afterJoin), joined.status !== 200 ? `adding the member got ${joined.status}: ${errorText(joined.text)}` : afterJoin !== 200 ? `got ${afterJoin}` : null)
    const directRows = await prisma.userRole.count({ where: { userId, roleId: ctx.b.teamGrantRoleId } })
    push("nothing is copied into the user's roles", "0 rows", `${directRows} rows`, directRows !== 0 ? "the team role was copied into UserRole" : null)

    const left = await setMembers(originalMembers)
    const afterLeave = await opens()
    push("loses the role on leaving", "403", String(afterLeave), left.status !== 200 ? `removing the member got ${left.status}: ${errorText(left.text)}` : afterLeave !== 403 ? `got ${afterLeave}` : null)

    const direct = await admin.request("PATCH", `/api/users/${userId}`, { json: { roleIds: [ctx.b.teamGrantRoleId] } })
    await setMembers([...originalMembers, userId])
    await setMembers(originalMembers)
    const afterBoth = await opens()
    push("keeps a role also given directly", "200", String(afterBoth), direct.status !== 200 ? `giving the role got ${direct.status}: ${errorText(direct.text)}` : afterBoth !== 200 ? `got ${afterBoth}` : null)
  } finally {
    await prisma.teamMember.deleteMany({ where: { teamId: salesId, userId: { notIn: originalMembers } } })
    await setUserRoles(prisma, userId, originalRoles)
  }
}

// Moving an opportunity to another team: Test Admin B (viewAll) moves the
// Sales unassigned opportunity to Support (one team_changed entry with the
// names and ids), and the Sales viewer's opportunity to General with a new
// owner from General (Test Rep B) in the same request. Both are put back,
// and the entries removed.
// The legitimate side of the grant and membership rank rules. Test Team
// Manager B removes Team Lite from Ops and attaches it again (it ranks
// above it and holds its only permission), adds Test Team Basic B (ranked
// below it), and removes itself; Test Manager B gives Team Lite to Test
// Everyone B directly. Ops' members and default roles and Test Everyone
// B's roles are put back afterwards.
async function checkGrantRules(prisma: PrismaClient, teamManager: Session, manager: Session, ctx: AttemptContext, rows: Row[]) {
  const opsId = ctx.fx.opsTeamId
  const everyoneId = ctx.fx.everyoneUserId
  const push = (who: string, name: string, res: { status: number; text: string }) =>
    rows.push({ attempt: `[${who}] Grant rules: ${name}`, expected: "200", actual: String(res.status), result: res.status === 200 ? "PASS" : "FAIL", note: res.status === 200 ? undefined : errorText(res.text) })
  const originalMembers = (await prisma.teamMember.findMany({ where: { teamId: opsId }, select: { userId: true } })).map((m) => m.userId)
  const originalRoles = (await prisma.teamDefaultRole.findMany({ where: { teamId: opsId }, select: { roleId: true } })).map((r) => r.roleId)
  const everyoneRoles = (await prisma.userRole.findMany({ where: { userId: everyoneId }, select: { roleId: true } })).map((r) => r.roleId)
  try {
    push("Team Manager B", "remove a team's default role", await teamManager.request("PUT", `/api/teams/${opsId}/default-roles`, { json: { roleIds: [] } }))
    push("Team Manager B", "attach a role it may give", await teamManager.request("PUT", `/api/teams/${opsId}/default-roles`, { json: { roleIds: [ctx.fx.teamLiteRoleId] } }))
    push("Team Manager B", "add a member ranked below it", await teamManager.request("PUT", `/api/teams/${opsId}/members`, { json: { userIds: [...originalMembers, ctx.fx.teamBasicUserId] } }))
    push("Team Manager B", "remove itself", await teamManager.request("PUT", `/api/teams/${opsId}/members`, { json: { userIds: [...originalMembers, ctx.fx.teamBasicUserId].filter((id) => id !== ctx.fx.teamManagerUserId) } }))
    push("Manager B", "give a role it may give", await manager.request("PATCH", `/api/users/${everyoneId}`, { json: { roleIds: [ctx.fx.teamLiteRoleId] } }))
  } finally {
    await prisma.teamMember.deleteMany({ where: { teamId: opsId, userId: { notIn: originalMembers } } })
    await prisma.teamMember.createMany({ data: originalMembers.map((userId) => ({ teamId: opsId, userId })), skipDuplicates: true })
    await prisma.teamDefaultRole.deleteMany({ where: { teamId: opsId, roleId: { notIn: originalRoles } } })
    await prisma.teamDefaultRole.createMany({ data: originalRoles.map((roleId) => ({ teamId: opsId, roleId })), skipDuplicates: true })
    await setUserRoles(prisma, everyoneId, everyoneRoles)
  }
}

async function checkTeamChange(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[Admin B] Team change: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const unassignedId = ctx.fx.salesUnassignedOpportunityId
  const ownedId = ctx.fx.salesViewerOpportunityId
  const startedAt = new Date()
  const original = await prisma.opportunity.findMany({ where: { id: { in: [unassignedId, ownedId] } }, select: { id: true, teamId: true, ownerId: true } })
  try {
    const before = await prisma.timelineEntry.count({ where: { opportunityId: unassignedId } })
    const moved = await admin.request("PATCH", `/api/opportunities/${unassignedId}`, { json: { teamId: ctx.fx.supportTeamId } })
    const entries = await prisma.timelineEntry.findMany({ where: { opportunityId: unassignedId, createdAt: { gte: startedAt } }, select: { action: true, data: true } })
    const data = entries[0]?.data as { from?: { id?: string; name?: string }; to?: { id?: string; name?: string } } | undefined
    push("records one team_changed entry", "200, 1 team_changed", `${moved.status}, ${entries.length} added`,
      moved.status !== 200
        ? `got ${moved.status}: ${errorText(moved.text)}`
        : (await prisma.timelineEntry.count({ where: { opportunityId: unassignedId } })) - before !== 1 || entries[0]?.action !== "team_changed"
          ? `added ${entries.map((e) => e.action).join(", ") || "nothing"}`
          : data?.from?.id !== ctx.b.salesTeamId || data?.to?.id !== ctx.fx.supportTeamId || data?.to?.name !== ctx.names.supportTeam
            ? "the entry doesn't hold both teams' ids and names"
            : null)

    const withOwner = await admin.request("PATCH", `/api/opportunities/${ownedId}`, { json: { teamId: ctx.b.generalTeamId, ownerId: ctx.repUserId } })
    const saved = await prisma.opportunity.findUniqueOrThrow({ where: { id: ownedId }, select: { teamId: true, ownerId: true } })
    push("a new team with a new owner from it", "200, moved", String(withOwner.status),
      withOwner.status !== 200
        ? `got ${withOwner.status}: ${errorText(withOwner.text)}`
        : saved.teamId !== ctx.b.generalTeamId || saved.ownerId !== ctx.repUserId
          ? "the team or owner did not change"
          : null)
  } finally {
    for (const o of original) await prisma.opportunity.update({ where: { id: o.id }, data: { teamId: o.teamId, ownerId: o.ownerId } })
    await prisma.timelineEntry.deleteMany({ where: { opportunityId: { in: [unassignedId, ownedId] }, createdAt: { gte: startedAt } } })
  }
}

// Every line field a copy carries over (all but id, quoteId, createdAt)
// Notes through a fixed stage button, as Test Admin B on the unassigned
// sample opportunity: an empty note through Won (its note is optional)
// moves to the first WON stage, and a note through the custom button moves
// to its stage, each adding one NOTE entry that holds the move and the
// button's label. The stage, its dates, and the notes are put back.
async function checkActionButtonNotes(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const opportunityId = ctx.fx.unassignedOpportunityId
  const label = (name: string) => `[Admin B] Action button note: ${name}`
  const startedAt = new Date()
  const original = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, stageChangedAt: true, closedAt: true } })
  const won = await prisma.actionButton.findUniqueOrThrow({ where: { id: ctx.fx.wonButtonId }, select: { label: true, fixedStageId: true } })
  const custom = await prisma.actionButton.findUniqueOrThrow({ where: { id: ctx.b.actionButtonId }, select: { label: true, fixedStageId: true } })
  try {
    for (const step of [
      { name: "an empty note through Won moves to its stage", json: { body: "<p></p>", actionButtonId: ctx.fx.wonButtonId }, button: won, closed: true, empty: true },
      { name: "a note through the custom button moves to its stage", json: { body: "<p>Dev check button note</p>", actionButtonId: ctx.b.actionButtonId }, button: custom, closed: false, empty: false },
    ]) {
      const before = await prisma.timelineEntry.count({ where: { opportunityId } })
      const res = await admin.request("POST", `/api/opportunities/${opportunityId}/timeline`, { json: step.json })
      const added = (await prisma.timelineEntry.count({ where: { opportunityId } })) - before
      const latest = await prisma.timelineEntry.findFirst({ where: { opportunityId, createdAt: { gte: startedAt } }, orderBy: { createdAt: "desc" }, select: { kind: true, body: true, data: true } })
      const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, closedAt: true } })
      const data = latest?.data as { stageChange?: { to?: { id?: string } }; actionButton?: { label?: string } } | null
      const problem =
        res.status !== 200
          ? `got ${res.status}: ${errorText(res.text)}`
          : opp.stageId !== step.button.fixedStageId
            ? "the stage did not move to the button's stage"
            : step.closed !== (opp.closedAt !== null)
              ? "closedAt doesn't match the stage"
              : added !== 1
                ? `added ${added} entries, expected 1`
                : latest?.kind !== "NOTE" || data?.stageChange?.to?.id !== step.button.fixedStageId
                  ? "the note doesn't hold the stage change"
                  : data?.actionButton?.label !== step.button.label
                    ? "the note doesn't hold the button's label"
                    : step.empty && latest.body !== null
                      ? "an empty optional note stored a body"
                      : null
      rows.push({ attempt: label(step.name), expected: "200, stage moved, 1 entry", actual: `${res.status}, ${added} added`, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
    }
  } finally {
    await prisma.timelineEntry.deleteMany({ where: { opportunityId, createdAt: { gte: startedAt } } })
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { stageId: original.stageId, stageChangedAt: original.stageChangedAt, closedAt: original.closedAt } })
  }
}

// Test Admin B adds a hidden Note button and an Appointment button (a kind
// not built yet) through the API. The record list Test Opp Viewer B reads
// leaves both out, the admin list has both (Appointment marked not
// available), and a note through the hidden one is refused. Both are then
// deleted through the API (and by id afterwards, whatever happened).
async function checkRecordButtonList(prisma: PrismaClient, admin: Session, oppViewer: Session, ctx: AttemptContext, rows: Row[]) {
  const label = (name: string) => `[Admin B] Action button list: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const createdIds: string[] = []
  try {
    const create = async (body: Record<string, unknown>) => {
      const res = await admin.request("POST", "/api/action-buttons", { json: body })
      const id = res.status === 201 ? ((JSON.parse(res.text) as { id?: string }).id ?? null) : null
      if (id) createdIds.push(id)
      return { res, id }
    }
    const hidden = await create(buttonBody({ label: "Dev check hidden", isHidden: true }))
    push("a hidden button is created", "201", String(hidden.res.status), hidden.id ? null : `got ${hidden.res.status}: ${errorText(hidden.res.text)}`)
    // Appointment is configurable but not built yet (Raise Quote now is)
    const later = await create(buttonBody({ label: "Dev check appointment", kind: "APPOINTMENT" }))
    push("an Appointment button is created", "201", String(later.res.status), later.id ? null : `got ${later.res.status}: ${errorText(later.res.text)}`)
    if (!hidden.id || !later.id) return

    const record = await oppViewer.request("GET", "/api/action-buttons?for=opportunity")
    push("the record list leaves out hidden and unavailable kinds", "200, neither listed", String(record.status),
      record.status !== 200
        ? `got ${record.status}: ${errorText(record.text)}`
        : record.text.includes(hidden.id)
          ? "the hidden button is listed"
          : record.text.includes(later.id)
            ? "the Appointment button is listed"
            : !record.text.includes(ctx.fx.noteButtonId)
              ? "the Note button is missing"
              : null)

    const all = await admin.request("GET", "/api/action-buttons")
    const listed = all.status === 200 ? (JSON.parse(all.text) as { id: string; available?: boolean }[]) : []
    push("the admin list has both, Appointment not available", "200, both listed", String(all.status),
      all.status !== 200
        ? `got ${all.status}: ${errorText(all.text)}`
        : !listed.some((b) => b.id === hidden.id)
          ? "the hidden button is missing"
          : listed.find((b) => b.id === later.id)?.available !== false
            ? "the Appointment button isn't marked unavailable"
            : null)

    const note = await admin.request("POST", `/api/opportunities/${ctx.fx.unassignedOpportunityId}/timeline`, { json: { body: "<p>Should not exist</p>", actionButtonId: hidden.id } })
    push("a note through the hidden button is refused", '400 "Invalid action button"', String(note.status),
      note.status === 400 && errorText(note.text).includes("Invalid action button") ? null : `got ${note.status}: ${errorText(note.text)}`)

    for (const id of [hidden.id, later.id]) {
      const del = await admin.request("DELETE", `/api/action-buttons/${id}`)
      push("a button is deleted", "200", String(del.status), del.status === 200 ? null : `got ${del.status}: ${errorText(del.text)}`)
    }
  } finally {
    if (createdIds.length > 0) await prisma.actionButton.deleteMany({ where: { id: { in: createdIds } } })
  }
}

// ─── Quotes linked to opportunities ──────────────────────────────────────────
// Test Admin B makes its own quotes through the API (never the run's sample
// quotes) and only ever changes their status through the status route, so
// no email can go out. It checks linking (and the refusals: no quote edit
// rights, a closed, deleted, or mismatched opportunity, and another team's
// opportunity Test Rep B can't see), that sending an unlinked quote creates
// one opportunity with the right team, owner, stage, source, and system
// note, that each quote event moves the stage by its rule (declined waits
// while another linked quote is still open), that a manual move isn't
// pulled back by a status change that isn't an event, that the value
// follows the latest quote, that sales orders and the purchase orders made
// from them carry the link, and that each step lands on the timeline and in
// the audit log. Everything it made is removed at the end, the
// opportunities the app created included.
async function checkQuoteOpportunities(prisma: PrismaClient, sessions: Record<Actor, Session>, ctx: AttemptContext, rows: Row[]) {
  const admin = sessions.admin
  const companyId = ctx.b.companyId
  const label = (name: string) => `[Admin B] Quote and opportunity: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const json = (text: string) => {
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const startedAt = new Date()
  const opportunitiesBefore = await opportunityIdsOf(prisma, [companyId])
  const quoteIds: string[] = []
  const salesOrderIds: string[] = []
  const purchaseOrderIds: string[] = []
  const stageIds = ctx.fx.opportunityStageIds
  const stages = await prisma.opportunityStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, category: true, sortOrder: true }, orderBy: { sortOrder: "asc" } })
  const firstWon = stages.find((s) => s.category === "WON")?.id
  const firstLost = stages.find((s) => s.category === "LOST")?.id
  const settings = await prisma.opportunitySettings.findUnique({ where: { companyId }, select: { quoteSentStageId: true } })
  const sentStage = settings?.quoteSentStageId
  if (!firstWon || !firstLost || !sentStage) throw new HarnessBroken("Test Company B's opportunity stages aren't as the run set them up")
  const stageOf = async (id: string) => (await prisma.opportunity.findUniqueOrThrow({ where: { id }, select: { stageId: true } })).stageId
  const entriesOn = (opportunityId: string) =>
    prisma.timelineEntry.findMany({ where: { opportunityId, createdAt: { gte: startedAt } }, select: { action: true, data: true, authorId: true, kind: true, body: true } })
  const auditActionsOn = async (opportunityId: string) =>
    (await prisma.auditLogEntry.findMany({ where: { companyId, recordId: opportunityId, createdAt: { gte: startedAt } }, select: { action: true } })).map((a) => a.action)
  const newQuote = async (lines: number[] = []) => {
    const res = await admin.request("POST", "/api/quotes", { json: { clientId: ctx.b.clientId, contactId: ctx.b.contactId, title: "Dev check linked quote" } })
    const id = typeof json(res.text).id === "string" ? (json(res.text).id as string) : null
    if (!id) throw new HarnessBroken(`couldn't create a quote: ${res.status} ${errorText(res.text)}`)
    quoteIds.push(id)
    for (const unitPrice of lines) {
      await admin.request("POST", `/api/quotes/${id}/line-items`, { json: { name: "Dev check line", quantity: 1, unitPrice, catalogItemId: ctx.b.catalogItemId } })
    }
    return id
  }
  const newOpportunity = async (extra: Record<string, unknown> = {}) => {
    const res = await admin.request("POST", "/api/opportunities", {
      json: { title: "Dev check quote link", clientId: ctx.b.clientId, contactId: ctx.b.contactId, initialNote: OPP_NOTE, ...extra },
    })
    const id = typeof json(res.text).id === "string" ? (json(res.text).id as string) : null
    if (!id) throw new HarnessBroken(`couldn't create an opportunity: ${res.status} ${errorText(res.text)}`)
    return id
  }
  const status = (quoteId: string, s: string) => admin.request("POST", `/api/quotes/${quoteId}/status`, { json: { status: s } })
  const refusedAs = (res: { status: number; text: string }, code: number, text: string) =>
    res.status === code && errorText(res.text).includes(text) ? null : `got ${res.status}: ${errorText(res.text)}`

  try {
    // ── Linking ──
    const openId = await newOpportunity()
    const quoteA = await newQuote()
    const linked = await admin.request("PATCH", `/api/quotes/${quoteA}`, { json: { opportunityId: openId } })
    const versionRes = await admin.request("POST", `/api/quotes/${quoteA}/versions`)
    const versionId = typeof json(versionRes.text).id === "string" ? (json(versionRes.text).id as string) : null
    if (versionId) quoteIds.push(versionId)
    const family = await prisma.quote.findMany({ where: { id: { in: versionId ? [quoteA, versionId] : [quoteA] } }, select: { opportunityId: true } })
    const linkEntries = await entriesOn(openId)
    push("a draft links to an open opportunity of its client and contact, and a new version keeps it", "200, both versions linked", String(linked.status),
      linked.status !== 200
        ? `got ${linked.status}: ${errorText(linked.text)}`
        : family.length !== 2 || family.some((q) => q.opportunityId !== openId)
          ? "a version isn't linked"
          : !linkEntries.some((e) => e.action === "quote_linked") || !(await auditActionsOn(openId)).includes("quote_linked")
            ? "no quote_linked timeline or audit entry"
            : null)

    const wonId = await newOpportunity({ stageId: firstWon })
    const deletedId = await newOpportunity()
    await admin.request("DELETE", `/api/opportunities/${deletedId}`)
    const otherClientId = await newOpportunity({ clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId })
    const quoteB = await newQuote([250])
    const refusals: [string, string][] = [
      ["a closed opportunity", wonId],
      ["a deleted opportunity", deletedId],
      ["another client's opportunity", otherClientId],
    ]
    for (const [name, opportunityId] of refusals) {
      const res = await admin.request("PATCH", `/api/quotes/${quoteB}`, { json: { opportunityId } })
      push(`linking to ${name} is refused`, '400 "Invalid opportunity"', String(res.status), refusedAs(res, 400, "Invalid opportunity"))
    }
    const hidden = await sessions.rep.request("PATCH", `/api/quotes/${ctx.fx.repQuoteId}`, { json: { opportunityId: ctx.fx.salesViewerOpportunityId } })
    push("Test Rep B can't link its quote to another team's opportunity it can't see", '400 "Invalid opportunity"', String(hidden.status), refusedAs(hidden, 400, "Invalid opportunity"))
    const noEdit = await sessions.oppViewer.request("PATCH", `/api/quotes/${ctx.fx.repQuoteId}`, { json: { opportunityId: ctx.fx.unassignedOpportunityId } })
    push("linking needs quote edit rights", "403", String(noEdit.status), noEdit.status === 403 ? null : `got ${noEdit.status}: ${errorText(noEdit.text)}`)
    const repQuote = await prisma.quote.findUniqueOrThrow({ where: { id: ctx.fx.repQuoteId }, select: { opportunityId: true } })
    const quoteBBefore = await prisma.quote.findUniqueOrThrow({ where: { id: quoteB }, select: { opportunityId: true } })
    push("the refused links changed nothing", "not linked", repQuote.opportunityId || quoteBBefore.opportunityId ? "linked" : "none",
      repQuote.opportunityId || quoteBBefore.opportunityId ? "a refused link was saved" : null)

    // ── Sending an unlinked quote ──
    const sent = await status(quoteB, "SENT")
    const quoteBRow = await prisma.quote.findUniqueOrThrow({ where: { id: quoteB }, select: { opportunityId: true, quoteNumber: true } })
    const autoId = quoteBRow.opportunityId
    const auto = autoId
      ? await prisma.opportunity.findUniqueOrThrow({ where: { id: autoId }, select: { teamId: true, ownerId: true, stageId: true, source: true, clientId: true, contactId: true } })
      : null
    const autoNote = autoId ? (await entriesOn(autoId)).find((e) => e.kind === "NOTE") : undefined
    push("sending an unlinked quote creates its opportunity", "Ops team, Test Admin B, quote sent stage, QUOTE, system note", String(sent.status),
      sent.status !== 200
        ? `got ${sent.status}: ${errorText(sent.text)}`
        : !auto
          ? "no opportunity was linked"
          : auto.teamId !== ctx.fx.opsTeamId || auto.ownerId !== ctx.b.adminId
            ? "wrong team or owner (the owner's first team, with the owner)"
            : auto.stageId !== sentStage || auto.source !== "QUOTE" || auto.clientId !== ctx.b.clientId || auto.contactId !== ctx.b.contactId
              ? "wrong stage, source, client, or contact"
              : autoNote?.authorId !== null || !autoNote?.body?.includes(`Created automatically when quote ${quoteBRow.quoteNumber} was sent`)
                ? "no system written initial note"
                : null)
    // Four made above by hand, and one by the send
    const madeCount = (await opportunityIdsOf(prisma, [companyId])).filter((id) => !opportunitiesBefore.includes(id)).length
    push("sending made exactly one opportunity", "5 new (4 by hand, 1 by the send)", String(madeCount), madeCount === 5 ? null : `${madeCount} new opportunities`)

    // ── Events ──
    if (autoId) {
      const accepted = await status(quoteB, "ACCEPTED")
      const so = await prisma.salesOrder.findFirst({ where: { quoteId: quoteB }, select: { id: true, opportunityId: true, lineItems: { select: { id: true } } } })
      if (so) salesOrderIds.push(so.id)
      const entries = await entriesOn(autoId)
      const move = entries.find((e) => e.action === "stage_changed")
      const reason = move?.data && typeof move.data === "object" ? String((move.data as { reason?: unknown }).reason ?? "") : ""
      push("accepted moves to the first Won stage and the sales order carries the link", "Won, sales order linked", String(accepted.status),
        accepted.status !== 200
          ? `got ${accepted.status}: ${errorText(accepted.text)}`
          : (await stageOf(autoId)) !== firstWon
            ? "not in the first Won stage"
            : !reason.includes("accepted")
              ? "no stage_changed entry naming the quote event"
              : so?.opportunityId !== autoId
                ? "the sales order isn't linked"
                : !entries.some((e) => e.action === "sales_order_linked")
                  ? "no sales_order_linked entry"
                  : null)
      const audit = await auditActionsOn(autoId)
      const wanted = ["created", "quote_linked", "quote_sent", "quote_accepted", "field_changed", "sales_order_linked"]
      push("the automatic steps are in the audit log", wanted.join(", "), String(audit.length), wanted.every((a) => audit.includes(a)) ? null : `has ${[...new Set(audit)].join(", ")}`)

      if (so && so.lineItems.length > 0) {
        const po = await admin.request("POST", "/api/purchase-orders", { json: { vendorId: ctx.b.vendorId, salesOrderId: so.id, soLineItemIds: so.lineItems.map((l) => l.id) } })
        const poId = typeof json(po.text).id === "string" ? (json(po.text).id as string) : null
        if (poId) purchaseOrderIds.push(poId)
        const poRow = poId ? await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { opportunityId: true } }) : null
        push("a purchase order generated from the sales order carries its link", "linked", String(po.status),
          !poId
            ? `got ${po.status}: ${errorText(po.text)}`
            : poRow?.opportunityId !== autoId
              ? "not linked"
              : !(await entriesOn(autoId)).some((e) => e.action === "purchase_order_linked")
                ? "no purchase_order_linked entry"
                : null)
      } else {
        push("a purchase order generated from the sales order carries its link", "a sales order with lines", "none", "the accepted quote made no sales order with lines")
      }
    }

    // Declined waits while another linked quote is open
    const dealId = await newOpportunity()
    const quoteC = await newQuote([123.456])
    const quoteD = await newQuote()
    await admin.request("PATCH", `/api/quotes/${quoteC}`, { json: { opportunityId: dealId } })
    await admin.request("PATCH", `/api/quotes/${quoteD}`, { json: { opportunityId: dealId } })
    await status(quoteC, "SENT")
    const afterSend = await stageOf(dealId)
    await status(quoteC, "DECLINED")
    const afterFirstDecline = await stageOf(dealId)
    await status(quoteD, "DECLINED")
    const afterSecondDecline = await stageOf(dealId)
    push("sent moves an open opportunity to the quote sent stage", "quote sent stage", afterSend === sentStage ? "moved" : "not moved", afterSend === sentStage ? null : "not in the quote sent stage")
    push("declined waits while another linked quote is still open", "unchanged, then Lost",
      `${afterFirstDecline === sentStage ? "unchanged" : "moved"}, then ${afterSecondDecline === firstLost ? "Lost" : "not Lost"}`,
      afterFirstDecline !== sentStage ? "moved while a draft was still open" : afterSecondDecline !== firstLost ? "didn't move to Lost once nothing was open" : null)

    // A manual move isn't pulled back by a change that isn't an event
    await admin.request("PATCH", `/api/opportunities/${dealId}`, { json: { stageId: stageIds[0] } })
    await status(quoteC, "DRAFT")
    const afterNonEvent = await stageOf(dealId)
    push("a manual move stays after a status change that isn't an event", "first stage", afterNonEvent === stageIds[0] ? "kept" : "moved", afterNonEvent === stageIds[0] ? null : "the stage was pulled back")

    // The value follows the latest quote: C is the only one ever sent
    const read = await admin.request("GET", `/api/opportunities/${dealId}`)
    const quoteValue = json(read.text).quoteValue as { quoteId?: string; value?: string } | null | undefined
    push("the value follows the latest sent quote, rounded to cents", "123.46 from the sent quote", quoteValue?.value ?? "none",
      quoteValue?.quoteId !== quoteC ? "not the most recently sent quote" : quoteValue?.value !== "123.46" ? `value ${quoteValue?.value}` : null)
    const manual = await admin.request("PATCH", `/api/opportunities/${dealId}`, { json: { expectedValue: "10" } })
    push("the manual value is refused while quotes are linked", "400 VALUE_FROM_QUOTE", String(manual.status),
      manual.status === 400 && manual.text.includes("VALUE_FROM_QUOTE") ? null : `got ${manual.status}: ${errorText(manual.text)}`)

    // Manual orders take an opportunity of their client
    const soRes = await admin.request("POST", "/api/sales-orders", { json: { clientId: ctx.b.clientId, opportunityId: dealId } })
    const manualSoId = typeof json(soRes.text).id === "string" ? (json(soRes.text).id as string) : null
    if (manualSoId) salesOrderIds.push(manualSoId)
    const poRes = await admin.request("POST", "/api/purchase-orders", { json: { vendorId: ctx.b.vendorId, opportunityId: dealId } })
    const manualPoId = typeof json(poRes.text).id === "string" ? (json(poRes.text).id as string) : null
    if (manualPoId) purchaseOrderIds.push(manualPoId)
    const [manualSo, manualPo] = await Promise.all([
      manualSoId ? prisma.salesOrder.findUnique({ where: { id: manualSoId }, select: { opportunityId: true } }) : null,
      manualPoId ? prisma.purchaseOrder.findUnique({ where: { id: manualPoId }, select: { opportunityId: true } }) : null,
    ])
    push("manual sales and purchase orders carry the link", "both linked", `${soRes.status}, ${poRes.status}`,
      manualSo?.opportunityId !== dealId || manualPo?.opportunityId !== dealId ? "an order isn't linked" : null)
    const dealActions = (await entriesOn(dealId)).map((e) => e.action)
    const wantedActions = ["quote_linked", "quote_sent", "quote_declined", "stage_changed", "sales_order_linked", "purchase_order_linked"]
    push("every link and event is on the timeline", wantedActions.join(", "), String(dealActions.length),
      wantedActions.every((a) => dealActions.includes(a)) ? null : `has ${[...new Set(dealActions)].join(", ")}`)
  } finally {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } })
    await prisma.salesOrder.deleteMany({ where: { id: { in: salesOrderIds } } })
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } })
    await removeOpportunitiesAddedSince(prisma, [companyId], opportunitiesBefore)
  }
}

// When an opportunity is created, and the client change rule. Test Admin B
// makes its own quotes (contactless ones included) and opportunities
// through the API and changes statuses only through the status route and
// Mark as sent with no email. A contactless draft moves to Declined and
// Expired, one at a time and several at once (the bulk Mark Lost and Mark
// Expired actions call the status route per quote), creating no
// opportunity; sending one is refused. Create opportunity on an accepted,
// a declined, and a sent quote lands on the first Won stage, the first Lost
// stage, and the quote sent stage. An opportunity with a linked quote
// refuses a new client (409) and takes a new contact of its client. The
// accepted and sent statuses are written to the database directly, since
// moving an unlinked quote there through the route would create its
// opportunity. Everything it made is removed at the end.
async function checkQuoteOpportunityRules(prisma: PrismaClient, sessions: Record<Actor, Session>, ctx: AttemptContext, rows: Row[]) {
  const admin = sessions.admin
  const companyId = ctx.b.companyId
  const label = (name: string) => `[Admin B] Opportunity rules: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const idOf = (text: string) => {
    try {
      const id = (JSON.parse(text) as { id?: unknown }).id
      return typeof id === "string" ? id : null
    } catch {
      return null
    }
  }
  const opportunitiesBefore = await opportunityIdsOf(prisma, [companyId])
  const added = async () => (await opportunityIdsOf(prisma, [companyId])).filter((id) => !opportunitiesBefore.includes(id))
  const quoteIds: string[] = []
  let extraContactId: string | null = null
  const newQuote = async (withContact: boolean) => {
    const res = await admin.request("POST", "/api/quotes", {
      json: { clientId: ctx.b.clientId, ...(withContact ? { contactId: ctx.b.contactId } : {}), title: "Dev check opportunity rules" },
    })
    const id = idOf(res.text)
    if (!id) throw new HarnessBroken(`couldn't create a quote: ${res.status} ${errorText(res.text)}`)
    quoteIds.push(id)
    return id
  }
  const status = (quoteId: string, s: string) => admin.request("POST", `/api/quotes/${quoteId}/status`, { json: { status: s } })
  const quoteState = (id: string) => prisma.quote.findUniqueOrThrow({ where: { id }, select: { status: true, opportunityId: true } })

  try {
    // ── Contactless drafts close without an opportunity ──
    const single = [await newQuote(false), await newQuote(false)]
    const singleRes = [await status(single[0], "DECLINED"), await status(single[1], "EXPIRED")]
    const bulk = [await newQuote(false), await newQuote(false), await newQuote(false)]
    const bulkRes = await Promise.all([status(bulk[0], "DECLINED"), status(bulk[1], "DECLINED"), status(bulk[2], "EXPIRED")])
    const closed = await Promise.all([...single, ...bulk].map(quoteState))
    const wanted = ["DECLINED", "EXPIRED", "DECLINED", "DECLINED", "EXPIRED"]
    const madeAfterClose = (await added()).length
    push("a contactless draft moves to Declined and Expired, one at a time", "200, 200", singleRes.map((r) => r.status).join(", "),
      singleRes.some((r) => r.status !== 200) ? `got ${singleRes.map((r) => `${r.status} ${errorText(r.text)}`).join("; ")}` : null)
    push("contactless drafts move to Declined and Expired in bulk", "200 each", bulkRes.map((r) => r.status).join(", "),
      bulkRes.some((r) => r.status !== 200) ? `got ${bulkRes.map((r) => `${r.status} ${errorText(r.text)}`).join("; ")}` : null)
    push("closing drafts creates no opportunity", "statuses saved, none linked, none new", `${madeAfterClose} new`,
      closed.some((q, i) => q.status !== wanted[i])
        ? `statuses are ${closed.map((q) => q.status).join(", ")}`
        : closed.some((q) => q.opportunityId) || madeAfterClose > 0
          ? "an opportunity was created"
          : null)

    // ── Sending a contactless quote is refused ──
    const contactless = await newQuote(false)
    const viaStatus = await status(contactless, "SENT")
    const viaSend = await admin.request("POST", `/api/quotes/${contactless}/send`)
    const afterRefusal = await quoteState(contactless)
    for (const [name, res] of [["the status menu", viaStatus], ["Mark as sent", viaSend]] as const) {
      push(`sending a contactless quote through ${name} is refused`, '400 "Add a contact before sending"', String(res.status),
        res.status === 400 && errorText(res.text).includes("Add a contact before sending") ? null : `got ${res.status}: ${errorText(res.text)}`)
    }
    push("the refused sends changed nothing", "still DRAFT, no opportunity", afterRefusal.status,
      afterRefusal.status !== "DRAFT" || afterRefusal.opportunityId || (await added()).length > 0 ? "the quote or an opportunity changed" : null)

    // ── Create opportunity follows the quote's status ──
    const stages = await prisma.opportunityStage.findMany({ where: { companyId }, select: { id: true, category: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    const settings = await prisma.opportunitySettings.findUnique({ where: { companyId }, select: { quoteSentStageId: true } })
    const firstWon = stages.find((s) => s.category === "WON")?.id
    const firstLost = stages.find((s) => s.category === "LOST")?.id
    const accepted = await newQuote(true)
    await prisma.quote.update({ where: { id: accepted }, data: { status: "ACCEPTED", sentAt: new Date(), acceptedAt: new Date() } })
    const declined = await newQuote(true)
    await status(declined, "DECLINED")
    const sent = await newQuote(true)
    await prisma.quote.update({ where: { id: sent }, data: { status: "SENT", sentAt: new Date() } })
    const cases: [string, string, string | null | undefined, boolean][] = [
      ["an accepted quote", accepted, firstWon, true],
      ["a declined quote", declined, firstLost, true],
      ["a sent quote", sent, settings?.quoteSentStageId, false],
    ]
    for (const [name, quoteId, stageId, closesIt] of cases) {
      const res = await admin.request("POST", `/api/quotes/${quoteId}/opportunity`)
      const linked = await quoteState(quoteId)
      const o = linked.opportunityId
        ? await prisma.opportunity.findUnique({ where: { id: linked.opportunityId }, select: { stageId: true, closedAt: true } })
        : null
      push(`Create opportunity on ${name} lands on its stage`, closesIt ? "the matching closed stage, closedAt set" : "the quote sent stage", String(res.status),
        res.status !== 200
          ? `got ${res.status}: ${errorText(res.text)}`
          : !o
            ? "the quote isn't linked"
            : o.stageId !== stageId
              ? "wrong stage"
              : !!o.closedAt !== closesIt
                ? "closedAt doesn't match the stage"
                : null)
    }

    // ── The client can't change while records are linked ──
    const oppRes = await admin.request("POST", "/api/opportunities", {
      json: { title: "Dev check client lock", clientId: ctx.b.clientId, contactId: ctx.b.contactId, initialNote: OPP_NOTE },
    })
    const lockedId = idOf(oppRes.text)
    if (!lockedId) throw new HarnessBroken(`couldn't create an opportunity: ${oppRes.status} ${errorText(oppRes.text)}`)
    const linkedQuote = await newQuote(true)
    await admin.request("PATCH", `/api/quotes/${linkedQuote}`, { json: { opportunityId: lockedId } })
    const clientChange = await admin.request("PATCH", `/api/opportunities/${lockedId}`, { json: { clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId } })
    push("changing the client of an opportunity with a linked quote is refused", '409 "Unlink this opportunity\'s quotes and orders"', String(clientChange.status),
      clientChange.status === 409 && errorText(clientChange.text).includes("Unlink this opportunity's quotes and orders before changing its client")
        ? null
        : `got ${clientChange.status}: ${errorText(clientChange.text)}`)
    const extra = await prisma.contact.create({ data: { clientId: ctx.b.clientId, firstName: "Dev check", lastName: "Second contact" }, select: { id: true } })
    extraContactId = extra.id
    const contactChange = await admin.request("PATCH", `/api/opportunities/${lockedId}`, { json: { contactId: extra.id } })
    const lockedRow = await prisma.opportunity.findUniqueOrThrow({ where: { id: lockedId }, select: { clientId: true, contactId: true } })
    push("changing its contact within the client works", "200, new contact, same client", String(contactChange.status),
      contactChange.status !== 200
        ? `got ${contactChange.status}: ${errorText(contactChange.text)}`
        : lockedRow.contactId !== extra.id || lockedRow.clientId !== ctx.b.clientId
          ? "the contact or client is wrong"
          : null)
  } finally {
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } })
    await removeOpportunitiesAddedSince(prisma, [companyId], opportunitiesBefore)
    if (extraContactId) await prisma.contact.deleteMany({ where: { id: extraContactId } })
  }
}

// ─── Quote expiry job ───────────────────────────────────────────────────────

// The daily quote expiry job (expireOverdueQuotes, src/lib/quote-expiry-job.ts)
// on this run's Test Company B only (companyIds), so no other dev data is
// ever touched: a sent quote past its Valid until date linked to an open
// opportunity expires and moves it to the first Lost stage, by System on
// the timeline and in the audit log; a sent quote not yet due and a draft
// past due stay as they are; a second run expires nothing. The cron route
// is called without a secret and with a made up one (401, or 503 when the
// dev server has no CRON_SECRET; the real secret is never read or sent).
// Everything it made is removed.
async function checkQuoteExpiryJob(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[], baseUrl: string) {
  const companyId = ctx.b.companyId
  const label = (name: string) => `[System] Quote expiry job: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const idOf = (text: string) => {
    try {
      const id = (JSON.parse(text) as { id?: unknown }).id
      return typeof id === "string" ? id : null
    } catch {
      return null
    }
  }
  // Imported here, after the guard, like the database client
  const { expireOverdueQuotes } = await import("@/lib/quote-expiry-job")

  const opportunitiesBefore = await opportunityIdsOf(prisma, [companyId])
  const quoteIds: string[] = []
  const newQuote = async (title: string) => {
    const res = await admin.request("POST", "/api/quotes", { json: { clientId: ctx.b.clientId, contactId: ctx.b.contactId, title } })
    const id = idOf(res.text)
    if (!id) throw new HarnessBroken(`couldn't create a quote: ${res.status} ${errorText(res.text)}`)
    quoteIds.push(id)
    return id
  }
  const today = new Date()
  const dateOnly = (days: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days))

  try {
    const stages = await prisma.opportunityStage.findMany({ where: { companyId }, select: { id: true, category: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    const firstLost = stages.find((s) => s.category === "LOST")?.id
    if (!firstLost) throw new HarnessBroken("Test Company B has no Lost stage")

    // An open opportunity with one sent quote, past its date
    const oppRes = await admin.request("POST", "/api/opportunities", {
      json: { title: "Dev check quote expiry", clientId: ctx.b.clientId, contactId: ctx.b.contactId, initialNote: OPP_NOTE },
    })
    const opportunityId = idOf(oppRes.text)
    if (!opportunityId) throw new HarnessBroken(`couldn't create an opportunity: ${oppRes.status} ${errorText(oppRes.text)}`)
    const overdue = await newQuote("Dev check expiry overdue")
    const link = await admin.request("PATCH", `/api/quotes/${overdue}`, { json: { opportunityId } })
    const send = await admin.request("POST", `/api/quotes/${overdue}/status`, { json: { status: "SENT" } })
    if (link.status !== 200 || send.status !== 200) {
      throw new HarnessBroken(`couldn't link and send the overdue quote: ${link.status} ${errorText(link.text)}, ${send.status} ${errorText(send.text)}`)
    }
    await prisma.quote.update({ where: { id: overdue }, data: { expiresAt: dateOnly(-3) } })

    // A sent quote not due yet, and a draft past due (written directly, so
    // neither gets an opportunity of its own)
    const notDue = await newQuote("Dev check expiry not due")
    await prisma.quote.update({ where: { id: notDue }, data: { status: "SENT", sentAt: new Date(), expiresAt: dateOnly(30) } })
    const draft = await newQuote("Dev check expiry draft")
    await prisma.quote.update({ where: { id: draft }, data: { expiresAt: dateOnly(-3) } })

    // ── The job ──
    const startedAt = new Date()
    const first = await expireOverdueQuotes({ companyIds: [companyId], limit: 200 })
    const states = await prisma.quote.findMany({ where: { id: { in: [overdue, notDue, draft] } }, select: { id: true, status: true } })
    const statusOf = (id: string) => states.find((q) => q.id === id)?.status
    push("only the overdue sent quote expires", "overdue EXPIRED, not due SENT, draft DRAFT, 1 expired, no errors",
      `${statusOf(overdue)}, ${statusOf(notDue)}, ${statusOf(draft)}, ${first.expired} expired, ${first.errors.length} errors`,
      first.errors.length > 0
        ? `errors: ${first.errors.map((e) => e.error).join("; ")}`
        : statusOf(overdue) !== "EXPIRED" || statusOf(notDue) !== "SENT" || statusOf(draft) !== "DRAFT"
          ? "a quote has the wrong status"
          : first.items.length !== 1 || first.items[0].quoteId !== overdue
            ? `expired ${first.items.map((i) => i.quoteId).join(", ") || "nothing"} in Test Company B`
            : null)

    const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { stageId: true, closedAt: true } })
    push("its opportunity moves to the first Lost stage", "first Lost stage, closedAt set", opportunity.stageId === firstLost ? "Lost" : "another stage",
      opportunity.stageId !== firstLost ? "the opportunity didn't move to the first Lost stage" : !opportunity.closedAt ? "closedAt isn't set" : null)

    const entries = await prisma.timelineEntry.findMany({ where: { opportunityId, createdAt: { gte: startedAt } }, select: { action: true, authorId: true } })
    const expiredEntry = entries.find((e) => e.action === "quote_expired")
    const movedEntry = entries.find((e) => e.action === "stage_changed")
    push("the timeline shows the expiry and the move by System", "quote_expired and stage_changed, no author", entries.map((e) => e.action).join(", ") || "none",
      !expiredEntry || !movedEntry ? "an entry is missing" : expiredEntry.authorId || movedEntry.authorId ? "an entry has an author" : null)

    const audit = await prisma.auditLogEntry.findMany({ where: { companyId, recordId: opportunityId, createdAt: { gte: startedAt } }, select: { action: true, field: true, actorId: true, actorName: true } })
    const auditExpired = audit.find((a) => a.action === "quote_expired")
    const auditStage = audit.find((a) => a.action === "field_changed" && a.field === "stageId")
    push("the audit log shows the expiry and the move by System", "quote_expired and field_changed stageId, System", audit.map((a) => `${a.action} by ${a.actorName}`).join(", ") || "none",
      !auditExpired || !auditStage
        ? "an audit entry is missing"
        : [auditExpired, auditStage].some((a) => a.actorId !== null || a.actorName !== "System")
          ? "an audit entry isn't by System"
          : null)

    const second = await expireOverdueQuotes({ companyIds: [companyId], limit: 200 })
    push("a second run expires nothing new", "0 expired", `${second.expired} expired`,
      second.expired !== 0 || second.errors.length > 0 ? `expired ${second.expired}, ${second.errors.length} errors` : null)

    // ── The cron route refuses without the secret ──
    const url = `${baseUrl}/api/cron/expire-quotes`
    const noSecret = await fetchOrExplain(url, { redirect: "manual" }, "GET /api/cron/expire-quotes")
    const wrongSecret = await fetchOrExplain(url, { redirect: "manual", headers: { Authorization: `Bearer dev-check-${Math.random().toString(16).slice(2)}` } }, "GET /api/cron/expire-quotes")
    const bodies = [await noSecret.text(), await wrongSecret.text()]
    const configured = noSecret.status === 401
    const wanted = configured ? '{"error":"Unauthorized"}' : '{"error":"Not configured"}'
    const afterRoute = await prisma.quote.findUniqueOrThrow({ where: { id: notDue }, select: { status: true } })
    push(`the cron route refuses without the secret (${configured ? "401, the server has CRON_SECRET" : "503, the server has no CRON_SECRET"})`,
      "401 or 503 with no details, both the same", `${noSecret.status}, ${wrongSecret.status}`,
      ![401, 503].includes(noSecret.status) || wrongSecret.status !== noSecret.status
        ? `got ${noSecret.status} without and ${wrongSecret.status} with a made up secret`
        : bodies.some((b) => b !== wanted)
          ? "the answer says more than it should"
          : afterRoute.status !== "SENT"
            ? "a quote changed"
            : null)
  } finally {
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } })
    await removeOpportunitiesAddedSince(prisma, [companyId], opportunitiesBefore)
  }
}

// ─── Audit log steps ─────────────────────────────────────────────────────────
// All three work on one opportunity Test Admin B creates through the API
// (unassigned, in General, so Test Opp Viewer B can open it too), and remove
// it at the end. Its audit entries stay until the run's teardown.

type AuditRow = { id: string; action: string; field: string | null; before: unknown; after: unknown; undoneAt: Date | null; undoOfId: string | null }

function auditHelpers(prisma: PrismaClient, ctx: AttemptContext, opportunityId: string) {
  const entries = (): Promise<AuditRow[]> =>
    prisma.auditLogEntry.findMany({
      where: { companyId: ctx.b.companyId, recordType: "OPPORTUNITY", recordId: opportunityId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, action: true, field: true, before: true, after: true, undoneAt: true, undoOfId: true },
    })
  // The entries one request added, by running it between two reads
  const added = async <T>(run: () => Promise<T>): Promise<{ result: T; rows: AuditRow[] }> => {
    const before = new Set((await entries()).map((e) => e.id))
    const result = await run()
    return { result, rows: (await entries()).filter((e) => !before.has(e.id)) }
  }
  const describe = (rows: AuditRow[]) => rows.map((r) => (r.field ? `${r.action}:${r.field}` : r.action)).join(", ") || "none"
  return { entries, added, describe }
}

const textOf = (value: unknown) => (value && typeof value === "object" ? String((value as { text?: unknown }).text ?? "") : "")
const idOf = (value: unknown) => (value && typeof value === "object" ? String((value as { id?: unknown }).id ?? "") : "")

// Every recorded action writes the right entries, and a PATCH that changes
// nothing writes none. Returns the opportunity it created, or null.
async function checkAuditRecording(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]): Promise<string | null> {
  const label = (name: string) => `[Admin B] Audit log: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })

  const create = await admin.request("POST", "/api/opportunities", {
    json: { initialNote: OPP_NOTE, title: "Dev check audit opportunity", clientId: ctx.b.clientId, contactId: ctx.b.contactId },
  })
  const createdJson = create.status === 200 ? (JSON.parse(create.text) as { id?: string; title?: string }) : null
  const opportunityId = createdJson?.id ?? null
  // The title as saved: the sample client has a prefix (TCB), so the server
  // saves "<PREFIX> - <title>" (src/lib/record-title.ts). The entries must
  // hold exactly what was saved, whatever the prefix.
  const createdTitle = createdJson?.title ?? ""
  if (!opportunityId) {
    push("create an opportunity for the audit steps", "200", String(create.status), `got ${create.status}: ${errorText(create.text)}`)
    return null
  }
  const { entries, added, describe } = auditHelpers(prisma, ctx, opportunityId)
  const base = `/api/opportunities/${opportunityId}`

  const created = await entries()
  push("create records one created entry", "created", describe(created), created.length !== 1 || created[0].action !== "created" ? `got ${describe(created)}` : null)

  const title = await added(() => admin.request("PATCH", base, { json: { title: "Dev check audit renamed" } }))
  const titleRow = title.rows[0]
  push("a title change records one field_changed entry with before and after", "field_changed:title", describe(title.rows),
    title.result.status !== 200 ? `got ${title.result.status}: ${errorText(title.result.text)}`
      : title.rows.length !== 1 || titleRow.field !== "title" ? `got ${describe(title.rows)}`
        : !createdTitle.endsWith("Dev check audit opportunity") ? `the create answered the title "${createdTitle}"`
          : titleRow.before !== createdTitle || titleRow.after !== "Dev check audit renamed" ? "wrong before or after" : null)

  const same = await added(() => admin.request("PATCH", base, { json: { title: "Dev check audit renamed" } }))
  push("a PATCH that changes nothing records nothing", "none", describe(same.rows),
    same.result.status !== 200 ? `got ${same.result.status}` : same.rows.length !== 0 ? `got ${describe(same.rows)}` : null)

  const otherStage = ctx.fx.opportunityStageIds[1]
  const stage = await added(() => admin.request("PATCH", base, { json: { stageId: otherStage } }))
  push("a stage change records field_changed with the stage names", "field_changed:stageId", describe(stage.rows),
    stage.result.status !== 200 ? `got ${stage.result.status}` : stage.rows.length !== 1 || stage.rows[0].field !== "stageId" || idOf(stage.rows[0].after) !== otherStage ? `got ${describe(stage.rows)}` : null)

  const note = await added(() => admin.request("POST", `${base}/timeline`, { json: { body: "<p>Dev check audit note</p>" } }))
  const noteId = note.result.status === 200 ? ((JSON.parse(note.result.text) as { id?: string }).id ?? null) : null
  push("a note records note_added with its text", "note_added", describe(note.rows),
    !noteId ? `got ${note.result.status}` : note.rows.length !== 1 || note.rows[0].action !== "note_added" || !textOf(note.rows[0].after).includes("Dev check audit note") ? `got ${describe(note.rows)}` : null)

  const firstStage = ctx.fx.opportunityStageIds[0]
  const stageNote = await added(() => admin.request("POST", `${base}/timeline`, { json: { body: "<p>Dev check audit stage note</p>", stageId: firstStage } }))
  const stageNoteActions = stageNote.rows.map((r) => r.action).sort().join(",")
  push("a note that moves the stage records the stage change and the note", "field_changed:stageId, note_added", describe(stageNote.rows),
    stageNote.result.status !== 200 ? `got ${stageNote.result.status}` : stageNoteActions !== "field_changed,note_added" ? `got ${describe(stageNote.rows)}` : null)

  if (noteId) {
    const edit = await added(() => admin.request("PATCH", `${base}/timeline/${noteId}`, { json: { body: "<p>Dev check audit note, edited</p>" } }))
    push("editing a note records note_edited with the text before and after", "note_edited", describe(edit.rows),
      edit.result.status !== 200 ? `got ${edit.result.status}`
        : edit.rows.length !== 1 || edit.rows[0].action !== "note_edited" || !textOf(edit.rows[0].before).includes("Dev check audit note") || !textOf(edit.rows[0].after).includes("edited")
          ? `got ${describe(edit.rows)}` : null)

    const del = await added(() => admin.request("DELETE", `${base}/timeline/${noteId}`))
    push("deleting a note records note_deleted with its text", "note_deleted", describe(del.rows),
      del.result.status !== 200 ? `got ${del.result.status}` : del.rows.length !== 1 || del.rows[0].action !== "note_deleted" || !textOf(del.rows[0].before).includes("edited") ? `got ${describe(del.rows)}` : null)
  }
  return opportunityId
}

// A deleted opportunity disappears from the list, the opportunity (for
// users without auditLog.view), the sidebar counts, and its timeline,
// related, attachments, and email routes; restore brings it back. The
// email attempt is refused before anything is read or sent (404).
async function checkSoftDelete(prisma: PrismaClient, admin: Session, oppViewer: Session, ctx: AttemptContext, rows: Row[], opportunityId: string) {
  const label = (name: string) => `[Admin B] Soft delete: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const { added, describe, entries } = auditHelpers(prisma, ctx, opportunityId)
  const base = `/api/opportunities/${opportunityId}`
  const sidebarTotal = async () => {
    const res = await admin.request("GET", "/api/opportunities/sidebar-counts")
    return res.status === 200 ? ((JSON.parse(res.text) as { total?: number }).total ?? -1) : -1
  }
  const inList = async (session: Session) => (await session.request("GET", "/api/opportunities")).text.includes(opportunityId)

  // Open, so the sidebar counts it
  await admin.request("PATCH", base, { json: { stageId: ctx.fx.opportunityStageIds[0] } })
  const totalBefore = await sidebarTotal()
  const viewerBefore = await oppViewer.request("GET", base)
  push("before: Test Opp Viewer B can open it", "200", String(viewerBefore.status), viewerBefore.status !== 200 ? `got ${viewerBefore.status}` : null)
  const titleEntry = (await entries()).find((e) => e.action === "field_changed" && e.field === "title" && !e.undoneAt)

  const del = await added(() => admin.request("DELETE", base))
  const row = await prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { deletedAt: true, deletedById: true } })
  push("delete hides the row and records deleted", "200, row kept, deleted entry", `${del.result.status}, ${describe(del.rows)}`,
    del.result.status !== 200 ? `got ${del.result.status}: ${errorText(del.result.text)}`
      : !row ? "the row was erased"
        : !row.deletedAt || row.deletedById !== ctx.b.adminId ? "deletedAt or deletedById not set"
          : del.rows.length !== 1 || del.rows[0].action !== "deleted" ? `got ${describe(del.rows)}` : null)

  const gone: { name: string; session: Session; method: Method; path: string; json?: unknown }[] = [
    { name: "the opportunity (no audit access)", session: oppViewer, method: "GET", path: base },
    { name: "its timeline", session: admin, method: "GET", path: `${base}/timeline` },
    { name: "its related records", session: admin, method: "GET", path: `${base}/related` },
    { name: "its attachments", session: admin, method: "GET", path: `${base}/attachments` },
    { name: "its email options", session: admin, method: "GET", path: `${base}/email-options` },
    { name: "an email from it", session: admin, method: "POST", path: `${base}/email`, json: { to: ["nobody@example.test"], subject: "Dev only check, never sent", body: "<p>Dev only check, never sent</p>" } },
    { name: "a note on it", session: admin, method: "POST", path: `${base}/timeline`, json: { body: "<p>Should not exist</p>" } },
    { name: "an edit", session: admin, method: "PATCH", path: base, json: { title: "Should not change" } },
  ]
  for (const g of gone) {
    const res = await g.session.request(g.method, g.path, { json: g.json })
    push(`deleted: ${g.name} is not found`, "404", String(res.status), res.status !== 404 ? `got ${res.status}` : null)
  }
  push("deleted: the list leaves it out", "absent", "", (await inList(admin)) || (await inList(oppViewer)) ? "still listed" : null)
  const totalAfter = await sidebarTotal()
  push("deleted: the sidebar counts one fewer", `${totalBefore - 1}`, String(totalAfter), totalAfter !== totalBefore - 1 ? `was ${totalBefore}, now ${totalAfter}` : null)
  const adminGet = await admin.request("GET", base)
  push("deleted: an audit log viewer still opens it, marked deleted", "200, deletedAt set", String(adminGet.status),
    adminGet.status !== 200 ? `got ${adminGet.status}` : !(JSON.parse(adminGet.text) as { deletedAt?: string | null }).deletedAt ? "deletedAt missing" : null)
  if (titleEntry) {
    const undo = await admin.request("POST", `/api/audit-log/${titleEntry.id}/undo`)
    push("deleted: undo is refused until it is restored", "409", String(undo.status), undo.status !== 409 || !undo.text.includes("Restore it first") ? `got ${undo.status}: ${errorText(undo.text)}` : null)
  }

  const restore = await added(() => admin.request("POST", `${base}/restore`))
  const restoredRow = await prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { deletedAt: true } })
  const restoredAction = await prisma.timelineEntry.count({ where: { opportunityId, action: "restored" } })
  push("restore brings it back with a restored entry and timeline action", "200, restored", `${restore.result.status}, ${describe(restore.rows)}`,
    restore.result.status !== 200 ? `got ${restore.result.status}: ${errorText(restore.result.text)}`
      : restoredRow?.deletedAt ? "still deleted"
        : restore.rows.length !== 1 || restore.rows[0].action !== "restored" ? `got ${describe(restore.rows)}`
          : restoredAction !== 1 ? `${restoredAction} restored timeline actions` : null)
  const viewerAfter = await oppViewer.request("GET", base)
  push("restored: listed and open again", "listed, 200", String(viewerAfter.status),
    viewerAfter.status !== 200 ? `got ${viewerAfter.status}` : !(await inList(admin)) ? "not listed" : (await sidebarTotal()) !== totalBefore ? "the sidebar count didn't come back" : null)
  const again = await admin.request("POST", `${base}/restore`)
  push("restoring twice is refused", "409", String(again.status), again.status !== 409 ? `got ${again.status}` : null)
}

// Undo works once, is refused after a later change to the same field, and
// is refused when a rule fails (the old owner is no longer in the team).
// Test Rep B's General membership is put back in every case.
async function checkAuditUndo(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[], opportunityId: string) {
  const label = (name: string) => `[Admin B] Undo: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const { added, describe } = auditHelpers(prisma, ctx, opportunityId)
  const base = `/api/opportunities/${opportunityId}`
  const latest = async (field: string) =>
    prisma.auditLogEntry.findFirst({ where: { recordId: opportunityId, action: "field_changed", field }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } })
  const listed = async (entryId: string) => {
    const res = await admin.request("GET", `${base}/audit`)
    const page = res.status === 200 ? (JSON.parse(res.text) as { entries: { id: string; canUndo: boolean }[] }) : { entries: [] }
    return page.entries.find((e) => e.id === entryId) ?? null
  }

  const before = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { title: true } })
  await admin.request("PATCH", base, { json: { title: "Dev check undo A" } })
  const first = await latest("title")
  if (!first) {
    push("fixture", "a title change entry", "missing", "the title change wasn't recorded")
    return
  }
  push("the list offers undo on the latest change", "canUndo true", "", (await listed(first.id))?.canUndo ? null : "canUndo is not true")
  const timelineBefore = await prisma.timelineEntry.count({ where: { opportunityId, action: "title_changed" } })
  const undo = await added(() => admin.request("POST", `/api/audit-log/${first.id}/undo`))
  const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { title: true } })
  const original = await prisma.auditLogEntry.findUniqueOrThrow({ where: { id: first.id }, select: { undoneAt: true, undoneById: true } })
  const timelineAdded = (await prisma.timelineEntry.count({ where: { opportunityId, action: "title_changed" } })) - timelineBefore
  push("undo puts the old value back with one undone entry", "200, title back, undone entry", `${undo.result.status}, ${describe(undo.rows)}`,
    undo.result.status !== 200 ? `got ${undo.result.status}: ${errorText(undo.result.text)}`
      : after.title !== before.title ? "the title didn't go back"
        : undo.rows.length !== 1 || undo.rows[0].action !== "undone" || undo.rows[0].undoOfId !== first.id ? `got ${describe(undo.rows)}`
          : !original.undoneAt || original.undoneById !== ctx.b.adminId ? "the original isn't marked undone"
            : timelineAdded !== 1 ? `${timelineAdded} title_changed timeline actions` : null)
  const twice = await admin.request("POST", `/api/audit-log/${first.id}/undo`)
  push("undoing it again is refused", "409", String(twice.status), twice.status !== 409 || !twice.text.includes("already undone") ? `got ${twice.status}: ${errorText(twice.text)}` : null)

  await admin.request("PATCH", base, { json: { title: "Dev check undo B" } })
  const older = await latest("title")
  await admin.request("PATCH", base, { json: { title: "Dev check undo C" } })
  if (older) {
    const stale = await admin.request("POST", `/api/audit-log/${older.id}/undo`)
    push("undo after a later change to the same field is refused", "409", String(stale.status),
      stale.status !== 409 || !stale.text.includes("changed since") ? `got ${stale.status}: ${errorText(stale.text)}` : (await listed(older.id))?.canUndo ? "the list still offers it" : null)
  }

  // Owner Test Rep B, then Test Opp Viewer B; with Test Rep B out of General
  // the undo back to Test Rep B is refused, then allowed once it is back
  await admin.request("PATCH", base, { json: { ownerId: ctx.repUserId } })
  await admin.request("PATCH", base, { json: { ownerId: ctx.fx.oppViewerUserId } })
  const ownerChange = await latest("ownerId")
  const membership = { teamId: ctx.b.generalTeamId, userId: ctx.repUserId }
  try {
    await prisma.teamMember.deleteMany({ where: membership })
    if (ownerChange) {
      const refused = await admin.request("POST", `/api/audit-log/${ownerChange.id}/undo`)
      push("undo is refused when the old owner left the team", "409", String(refused.status),
        refused.status !== 409 || !refused.text.includes("no longer in the team") ? `got ${refused.status}: ${errorText(refused.text)}` : null)
    }
  } finally {
    await prisma.teamMember.upsert({ where: { teamId_userId: membership }, create: membership, update: {} })
  }
  if (ownerChange) {
    const allowed = await admin.request("POST", `/api/audit-log/${ownerChange.id}/undo`)
    const owner = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { ownerId: true } })
    push("undo goes through once the owner is back in the team", "200, owner back", String(allowed.status),
      allowed.status !== 200 ? `got ${allowed.status}: ${errorText(allowed.text)}` : owner.ownerId !== ctx.repUserId ? "the owner didn't go back" : null)
  }
}

const COPIED_LINE_FIELDS = [
  "catalogItemId", "section", "sortOrder", "name", "description", "sku", "quantity", "unitPrice", "cost", "discount", "taxable",
  "isRecurring", "recurringInterval", "isOptional", "optionalSelected", "quantityAdjustable", "choiceGroup", "isTextBlock",
  "bundleName", "bundleDisplayMode", "isBundleHeader",
] as const

// Quote correctness: a copy is a faithful duplicate of the quote's lines
// and sections, made for the client and contact picked for it, owned by
// whoever copied it, and leaves the original's PO number, internal notes,
// and progress behind. Test Admin B copies the copy fixture quote (every
// kind of line) for the copy client, then copies that copy for the sample
// client, and Test Rep B copies its own quote. Every copy made here is
// deleted at the end, its lines with it.
async function checkQuoteCopy(prisma: PrismaClient, admin: Session, rep: Session, ctx: AttemptContext, rows: Row[]) {
  const row = (who: string, name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[${who}] Quote copy: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const made: string[] = []
  async function copy(session: Session, quoteId: string, body: { clientId: string; contactId: string }) {
    const res = await session.request("POST", `/api/quotes/${quoteId}/copy`, { json: body })
    const id = res.status === 200 ? (JSON.parse(res.text) as { id?: string }).id : undefined
    if (id) made.push(id)
    return { res, id }
  }
  // The lines in the order the quote shows them, as the fields a copy keeps
  async function linesOf(quoteId: string) {
    const lines = await prisma.quoteLineItem.findMany({
      where: { quoteId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    return lines.map((l) => JSON.stringify(COPIED_LINE_FIELDS.map((f) => l[f])))
  }
  async function compare(who: string, name: string, sourceId: string, copyId: string) {
    const [a, b] = await Promise.all([linesOf(sourceId), linesOf(copyId)])
    const differs = a.length !== b.length ? `${b.length} lines instead of ${a.length}` : a.findIndex((l, i) => l !== b[i]) >= 0 ? `line ${a.findIndex((l, i) => l !== b[i]) + 1} differs` : null
    row(who, `${name} has the same lines`, `${a.length} identical lines`, `${b.length} lines`, differs)
    const lines = await prisma.quoteLineItem.findMany({ where: { quoteId: copyId } })
    const children = lines.filter((l) => l.bundleName && !l.isBundleHeader)
    const bundled = children.length > 0 && children.every((c) => lines.some((h) => h.isBundleHeader && h.bundleName === c.bundleName && h.section === c.section))
    const group = lines.filter((l) => l.choiceGroup)
    const selected = group.filter((l) => l.optionalSelected).length
    const structure = !bundled ? "bundle children without their header" : group.length < 2 || selected !== 1 ? "choice group lost its selected option" : null
    row(who, `${name} keeps the bundle and choice group`, "children under the new header, one option selected", `${children.length} children, ${group.length} options, ${selected} selected`, structure)
  }

  try {
    const source = await prisma.quote.findUniqueOrThrow({
      where: { id: ctx.fx.copyQuoteId },
      select: { sections: true, quoteNumber: true, accessToken: true, internalAccessToken: true },
    })

    // Admin B copies the fixture quote for the copy client
    const first = await copy(admin, ctx.fx.copyQuoteId, { clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId })
    row("Admin B", "copy for another client", "200", String(first.res.status), first.id ? null : errorText(first.res.text))
    if (first.id) {
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: first.id } })
      const problems = [
        q.clientId !== ctx.fx.copyClientId && "client is not the chosen one",
        q.contactId !== ctx.fx.copyContactId && "contact is not the chosen one",
        q.userId !== ctx.b.adminId && "not owned by the copier",
        q.status !== "DRAFT" && `status ${q.status}`,
        (q.sentAt || q.viewedAt || q.acceptedAt) && "carries the original's progress",
        q.clientPoNumber !== null && "kept the PO number",
        q.internalNotes !== null && "kept the internal notes",
        q.paymentTerms !== ctx.names.copyClientPaymentTerms && `payment terms ${q.paymentTerms} instead of the new client's`,
        q.shipAddress !== "2 Copy Street" && "ship to is not the new client's",
        JSON.stringify(q.sections) !== JSON.stringify(source.sections) && "section list differs",
        q.quoteNumber === source.quoteNumber && "same quote number",
        (q.accessToken === source.accessToken || q.internalAccessToken === source.internalAccessToken) && "same links",
        !q.expiresAt || q.expiresAt.getTime() <= Date.now() ? "no future expiry" : false,
      ].filter(Boolean)
      row("Admin B", "copy takes only the details and items", "new client, contact, owner, draft", problems.length ? "differs" : "as expected", problems.length ? problems.join(", ") : null)
      await compare("Admin B", "copy", ctx.fx.copyQuoteId, first.id)

      // A copy of the copy, for the sample client
      const second = await copy(admin, first.id, { clientId: ctx.b.clientId, contactId: ctx.b.contactId })
      row("Admin B", "copy of a copy", "200", String(second.res.status), second.id ? null : errorText(second.res.text))
      if (second.id) await compare("Admin B", "copy of a copy", ctx.fx.copyQuoteId, second.id)
    }

    // Test Rep B copies its own quote, and owns the copy
    const repCopy = await copy(rep, ctx.fx.repQuoteId, { clientId: ctx.fx.copyClientId, contactId: ctx.fx.copyContactId })
    row("Rep B", "copy own quote", "200", String(repCopy.res.status), repCopy.id ? null : errorText(repCopy.res.text))
    if (repCopy.id) {
      const q = await prisma.quote.findUniqueOrThrow({ where: { id: repCopy.id }, select: { userId: true } })
      row("Rep B", "the copy is the rep's", "owned by Test Rep B", q.userId === ctx.repUserId ? "Test Rep B" : "someone else", q.userId === ctx.repUserId ? null : "not owned by the copier")
      const opened = await rep.request("GET", `/api/quotes/${repCopy.id}`)
      row("Rep B", "the rep can open the copy", "200", String(opened.status), opened.status === 200 ? null : errorText(opened.text))
    }
  } finally {
    await prisma.quote.deleteMany({ where: { id: { in: made } } })
  }
}

// ─── Ticket steps ────────────────────────────────────────────────────────────
// Each works on tickets Test Admin B creates through the API (in Helpdesk
// unless noted) and removes them at the end. Their audit entries stay until
// the run's teardown.

interface TicketJson {
  id?: string
  number?: string
  title?: string
  assignee?: { id?: string } | null
  status?: { id?: string; category?: string } | null
  resolvedAt?: string | null
  closedAt?: string | null
  statusChangedAt?: string
}

const ticketJson = (text: string): TicketJson => {
  try {
    return JSON.parse(text) as TicketJson
  } catch {
    return {}
  }
}

async function newTicket(admin: Session, ctx: AttemptContext, extra: Record<string, unknown> = {}): Promise<TicketJson & { id: string }> {
  const res = await admin.request("POST", "/api/tickets", { json: ticketBody(ctx, { teamId: ctx.b.helpdeskTeamId, ...extra }) })
  const json = ticketJson(res.text)
  if (res.status !== 200 || !json.id) throw new HarnessBroken(`couldn't create a ticket: ${res.status} ${errorText(res.text)}`)
  return json as TicketJson & { id: string }
}

// Client prefixes on new titles (src/lib/record-title.ts). The sample
// client gets a prefix for the step (its own value is put back after).
// Test Admin B creates a ticket and an opportunity on it, each saved as
// "<PREFIX> - <title>"; a title that already starts with the prefix (in
// another case) is kept as typed; a ticket with no client keeps its title;
// and renaming the ticket afterwards saves the new title as typed.
// Everything it made is removed.
async function checkClientTitlePrefix(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `Client prefix: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const PREFIX = "DEVCHK"
  const client = await prisma.client.findUniqueOrThrow({ where: { id: ctx.b.clientId }, select: { prefix: true } })
  const tickets: string[] = []
  const opportunities: string[] = []
  await prisma.client.update({ where: { id: ctx.b.clientId }, data: { prefix: PREFIX } })
  try {
    const title = (text: string) => (JSON.parse(text || "{}") as { id?: string; title?: string })
    const ticket = await admin.request("POST", "/api/tickets", { json: ticketBody(ctx, { teamId: ctx.b.helpdeskTeamId, title: "Login Help" }) })
    const t = title(ticket.text)
    if (t.id) tickets.push(t.id)
    push("a new ticket on a client with a prefix", `"${PREFIX} - Login Help"`, ticket.status === 200 ? `"${t.title}"` : String(ticket.status),
      ticket.status !== 200 ? errorText(ticket.text) : t.title !== `${PREFIX} - Login Help` ? "the title isn't prefixed" : null)

    const again = await admin.request("POST", "/api/tickets", { json: ticketBody(ctx, { teamId: ctx.b.helpdeskTeamId, title: "devchk - Already prefixed" }) })
    const a = title(again.text)
    if (a.id) tickets.push(a.id)
    push("a title already starting with the prefix", '"devchk - Already prefixed"', again.status === 200 ? `"${a.title}"` : String(again.status),
      again.status !== 200 ? errorText(again.text) : a.title !== "devchk - Already prefixed" ? "the prefix was added twice" : null)

    const none = await admin.request("POST", "/api/tickets", { json: { initialNote: TICKET_NOTE, title: "No client here" } })
    const n = title(none.text)
    if (n.id) tickets.push(n.id)
    push("a ticket with no client", '"No client here"', none.status === 200 ? `"${n.title}"` : String(none.status),
      none.status !== 200 ? errorText(none.text) : n.title !== "No client here" ? "the title changed" : null)

    if (t.id) {
      const renamed = await admin.request("PATCH", `/api/tickets/${t.id}`, { json: { title: "Renamed later" } })
      push("renaming keeps the title as typed", '"Renamed later"', renamed.status === 200 ? `"${title(renamed.text).title}"` : String(renamed.status),
        renamed.status !== 200 ? errorText(renamed.text) : title(renamed.text).title !== "Renamed later" ? "the prefix was added on rename" : null)
    }

    const opp = await admin.request("POST", "/api/opportunities", {
      json: { title: "Network refresh", clientId: ctx.b.clientId, contactId: ctx.b.contactId, initialNote: OPP_NOTE },
    })
    const o = title(opp.text)
    if (o.id) opportunities.push(o.id)
    push("a new opportunity on a client with a prefix", `"${PREFIX} - Network refresh"`, opp.status === 200 ? `"${o.title}"` : String(opp.status),
      opp.status !== 200 ? errorText(opp.text) : o.title !== `${PREFIX} - Network refresh` ? "the title isn't prefixed" : null)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: { in: tickets } } })
    await prisma.opportunity.deleteMany({ where: { id: { in: opportunities } } })
    await prisma.client.update({ where: { id: ctx.b.clientId }, data: { prefix: client.prefix } })
  }
}

// Removing a company logo. Test Company B's logos are set to dummy links
// outside the uploads bucket for the step (so the route's file delete
// skips them and nothing reaches S3) and put back after. Test Manager B
// (Users settings only) is refused and changes nothing; Test Admin B
// removes the secondary logo, then the primary; company settings then
// answer no logo; and the internal portal preview, its PDF, and the staff
// quote PDF all still render.
const DUMMY_LOGO = "https://example.test/logos/dev-check-logo.png"
const DUMMY_SECONDARY_LOGO = "https://example.test/logos/dev-check-secondary-logo.png"

async function checkLogoRemoval(prisma: PrismaClient, sessions: Record<Actor, Session>, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `Company logo: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const companyId = ctx.b.companyId
  const original = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { logoUrl: true, secondaryLogoUrl: true } })
  const logos = () => prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { logoUrl: true, secondaryLogoUrl: true } })
  await prisma.company.update({ where: { id: companyId }, data: { logoUrl: DUMMY_LOGO, secondaryLogoUrl: DUMMY_SECONDARY_LOGO } })
  try {
    const refused = await sessions.manager.request("DELETE", "/api/company-settings/logo?slot=primary")
    const afterRefused = await logos()
    push("Test Manager B removes it", "403, logo kept", String(refused.status),
      refused.status !== 403 ? errorText(refused.text) : afterRefused.logoUrl !== DUMMY_LOGO ? "the logo was removed" : null)

    const badSlot = await sessions.admin.request("DELETE", "/api/company-settings/logo?slot=banner")
    push("a made up slot", "400", String(badSlot.status), badSlot.status !== 400 || !errorText(badSlot.text).includes("Invalid logo slot") ? errorText(badSlot.text) : null)

    const secondary = await sessions.admin.request("DELETE", "/api/company-settings/logo?slot=secondary")
    const afterSecondary = await logos()
    push("Test Admin B removes the secondary logo", "200, only the secondary cleared", String(secondary.status),
      secondary.status !== 200 ? errorText(secondary.text) : afterSecondary.secondaryLogoUrl !== null || afterSecondary.logoUrl !== DUMMY_LOGO ? "the wrong slot changed" : null)

    const primary = await sessions.admin.request("DELETE", "/api/company-settings/logo?slot=primary")
    const afterPrimary = await logos()
    push("Test Admin B removes the primary logo", "200, cleared", String(primary.status),
      primary.status !== 200 ? errorText(primary.text) : afterPrimary.logoUrl !== null ? "the logo is still set" : null)

    const settings = await sessions.everyone.request("GET", "/api/company-settings")
    push("company settings answer no logo", '200, "logoUrl":null', String(settings.status),
      settings.status !== 200 ? errorText(settings.text) : !settings.text.includes('"logoUrl":null') || !settings.text.includes('"secondaryLogoUrl":null') ? "a logo is still returned" : null)

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: ctx.b.quoteId }, select: { internalAccessToken: true } })
    const token = quote.internalAccessToken
    for (const [name, path, pdf] of [
      ["the internal portal preview", `/api/portal/${token}`, false],
      ["the portal page", `/portal/${token}`, false],
      ["the portal PDF", `/api/portal/${token}/pdf`, true],
      ["the staff quote PDF", `/api/quotes/${ctx.b.quoteId}/pdf`, true],
    ] as const) {
      const res = await sessions.admin.request("GET", path)
      push(`${name} renders with no logo`, pdf ? "200, a PDF" : "200", String(res.status),
        res.status !== 200 ? errorText(res.text) : pdf && !res.text.includes("%PDF") ? "not a PDF" : null)
    }
  } finally {
    await prisma.company.update({ where: { id: companyId }, data: original })
  }
}

// Page guards for the ticket screens, read as HTML like the Opportunities
// pages (checkOpportunityPages): the list, a ticket, and Settings > Tickets
const TICKET_SETTINGS_ENTRY = "Ticket Settings"

async function checkTicketPages(sessions: Record<Actor, Session>, labels: Record<Actor, string>, ctx: AttemptContext, rows: Row[]) {
  const pages: { name: string; path: string; allowed: Actor[]; refused: Actor[]; settings?: string }[] = [
    { name: "Tickets page", path: "/dashboard/tickets?view=all", allowed: ["admin", "ticketBasic", "ticketDispatcher"], refused: ["everyone", "ticketSettings", "oppViewer"] },
    { name: "Ticket page", path: `/dashboard/tickets/${ctx.fx.basicTicketId}`, allowed: ["admin", "ticketBasic"], refused: ["everyone", "ticketSettings", "clerk"] },
    { name: "Settings > Tickets", path: "/dashboard/settings?panel=tickets", allowed: ["admin", "ticketSettings"], refused: ["everyone", "manager", "oppSettings"], settings: TICKET_SETTINGS_ENTRY },
  ]
  for (const page of pages) {
    for (const [actor, allowed] of [...page.allowed.map((a) => [a, true] as const), ...page.refused.map((a) => [a, false] as const)]) {
      const res = await sessions[actor].request("GET", page.path)
      const pageRefused = res.text.includes(NO_ACCESS_PAGE)
      const opens = !pageRefused && (!page.settings || res.text.includes(page.settings))
      const problem =
        res.status !== 200
          ? `got ${res.status}${res.location ? ` to ${res.location}` : ""}`
          : allowed && !opens
            ? pageRefused
              ? "the page shows no access"
              : "the section is not listed in Settings"
            : !allowed && opens
              ? "the page opened"
              : null
      rows.push({
        attempt: `[${labels[actor]}] ${page.name}`,
        expected: allowed ? "200, opens" : "200, no access",
        actual: res.status === 200 ? (opens ? "200, opens" : "200, no access") : String(res.status),
        result: problem ? "FAIL" : "PASS",
        note: problem ?? undefined,
      })
    }
  }
}

// Assignment notifications: Test Ticket Dispatcher B creating a ticket for
// Test Ticket Viewer B, and Test Admin B reassigning it to Test Ticket
// Basic B, each give the new assignee one TICKET_ASSIGNED notification
// linking to the ticket; Test Ticket Basic B creating one for itself, and
// taking one for itself, give none. Everything made here is removed.
async function checkTicketAssignmentNotifications(prisma: PrismaClient, sessions: Record<Actor, Session>, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `Ticket assignment notification: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const viewer = ctx.fx.ticketViewerUserId
  const basic = ctx.fx.ticketBasicUserId
  const since = new Date()
  const created: string[] = []
  const notes = (userId: string, ticketId: string) =>
    prisma.notification.count({ where: { userId, type: "TICKET_ASSIGNED", link: `/dashboard/tickets/${ticketId}`, createdAt: { gte: since } } })
  try {
    const forViewer = await sessions.ticketDispatcher.request("POST", "/api/tickets", { json: ticketBody(ctx, { teamId: ctx.b.helpdeskTeamId, assigneeId: viewer }) })
    const t1 = ticketJson(forViewer.text)
    if (t1.id) created.push(t1.id)
    const n1 = t1.id ? await notes(viewer, t1.id) : -1
    push("a dispatcher creates one for a teammate", "1 for Test Ticket Viewer B", String(n1), forViewer.status !== 200 ? errorText(forViewer.text) : n1 !== 1 ? "expected exactly one" : null)

    if (t1.id) {
      const moved = await sessions.admin.request("PATCH", `/api/tickets/${t1.id}`, { json: { assigneeId: basic } })
      const n2 = await notes(basic, t1.id)
      push("an admin reassigns it", "1 for Test Ticket Basic B", String(n2), moved.status !== 200 ? errorText(moved.text) : n2 !== 1 ? "expected exactly one" : null)
      const same = await sessions.admin.request("PATCH", `/api/tickets/${t1.id}`, { json: { assigneeId: basic, title: "Dev check ticket, renamed" } })
      const n3 = await notes(basic, t1.id)
      push("a save that keeps the assignee", "still 1", String(n3), same.status !== 200 ? errorText(same.text) : n3 !== 1 ? "a second notification was sent" : null)
    }

    const own = await sessions.ticketBasic.request("POST", "/api/tickets", { json: ticketBody(ctx, { teamId: ctx.b.helpdeskTeamId, assigneeId: basic }) })
    const t2 = ticketJson(own.text)
    if (t2.id) created.push(t2.id)
    const n4 = t2.id ? await notes(basic, t2.id) : -1
    push("creating one for itself", "0", String(n4), own.status !== 200 ? errorText(own.text) : n4 !== 0 ? "it notified itself" : null)

    const unassigned = await sessions.ticketBasic.request("POST", "/api/tickets", { json: ticketBody(ctx, { teamId: ctx.b.helpdeskTeamId }) })
    const t3 = ticketJson(unassigned.text)
    if (t3.id) {
      created.push(t3.id)
      const take = await sessions.ticketBasic.request("PATCH", `/api/tickets/${t3.id}`, { json: { assigneeId: basic } })
      const n5 = await notes(basic, t3.id)
      push("taking one for itself", "0", String(n5), take.status !== 200 ? errorText(take.text) : n5 !== 0 ? "it notified itself" : null)
    }
  } finally {
    await prisma.notification.deleteMany({ where: { type: "TICKET_ASSIGNED", link: { in: created.map((id) => `/dashboard/tickets/${id}`) } } })
    await prisma.ticket.deleteMany({ where: { id: { in: created } } })
  }
}

// Round robin: three unassigned tickets in the Round Robin team go to Test
// Ticket Basic B, Test Ticket Viewer B, and Test Ticket Basic B again
// (Test Ticket Inactive B, deactivated and sorting between them, is
// skipped), each recorded as assigned by System; a named assignee is kept;
// and with round robin off a new ticket stays unassigned
async function checkTicketRoundRobin(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[Admin B] Round robin: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const teamId = ctx.fx.roundRobinTeamId
  const basic = ctx.fx.ticketBasicUserId
  const viewer = ctx.fx.ticketViewerUserId
  const created: string[] = []
  await prisma.team.update({ where: { id: teamId }, data: { roundRobinEnabled: true, roundRobinLastUserId: null } })
  try {
    const assignees: (string | null)[] = []
    for (let i = 1; i <= 3; i++) {
      const t = await newTicket(admin, ctx, { teamId, title: `Dev check round robin ${i}` })
      created.push(t.id)
      assignees.push(t.assignee?.id ?? null)
    }
    const expected = [basic, viewer, basic]
    const name = (id: string | null) => (id === basic ? "Basic" : id === viewer ? "Viewer" : id === ctx.fx.ticketInactiveUserId ? "Inactive" : id ? "someone else" : "nobody")
    push("unassigned tickets go round the active members", "Basic, Viewer, Basic", assignees.map(name).join(", "),
      assignees.every((a, i) => a === expected[i]) ? null : "the rotation is wrong or did not skip the inactive member")

    const assigned = await prisma.timelineEntry.findMany({ where: { ticketId: created[0], action: "assignee_changed" }, select: { authorId: true, data: true } })
    const reason = (assigned[0]?.data as { reason?: unknown } | null)?.reason
    push("the assignment is on the timeline by System", "one assignee_changed, no author, Round robin", `${assigned.length} entries`,
      assigned.length !== 1 ? "expected exactly one assignee_changed entry" : assigned[0].authorId ? "the entry has an author" : reason !== "Round robin" ? "the reason isn't Round robin" : null)
    const audit = await prisma.auditLogEntry.findFirst({ where: { recordType: "TICKET", recordId: created[0], action: "field_changed", field: "assigneeId" }, select: { actorId: true, actorName: true } })
    push("the assignment is in the audit log by System", "field_changed assigneeId by System", audit ? `by ${audit.actorName}` : "none",
      !audit ? "no audit entry" : audit.actorId !== null || audit.actorName !== "System" ? "the entry isn't by System" : null)

    const named = await newTicket(admin, ctx, { teamId, assigneeId: viewer, title: "Dev check round robin named" })
    created.push(named.id)
    const last = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { roundRobinLastUserId: true } })
    push("a named assignee is kept and doesn't move the rotation", "Viewer, last still Basic", `${name(named.assignee?.id ?? null)}, last ${name(last.roundRobinLastUserId)}`,
      named.assignee?.id !== viewer ? "the named assignee was replaced" : last.roundRobinLastUserId !== basic ? "the rotation moved" : null)

    await prisma.team.update({ where: { id: teamId }, data: { roundRobinEnabled: false } })
    const off = await newTicket(admin, ctx, { teamId, title: "Dev check round robin off" })
    created.push(off.id)
    push("with round robin off a new ticket stays unassigned", "nobody", name(off.assignee?.id ?? null), off.assignee ? "it was assigned" : null)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: { in: created } } })
    await prisma.team.update({ where: { id: teamId }, data: { roundRobinEnabled: true, roundRobinLastUserId: null } })
  }
}

// Status timestamps: resolvedAt and closedAt follow the status category
// through PATCH and notes, a status move records one entry, and a PATCH that
// moves nothing records none
async function checkTicketStatusTimestamps(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[Admin B] Ticket status: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const fx = ctx.fx
  const t = await newTicket(admin, ctx, { title: "Dev check ticket status" })
  const statusEntries = () => prisma.timelineEntry.count({ where: { ticketId: t.id, action: "status_changed" } })
  const patch = async (statusId: string) => {
    const res = await admin.request("PATCH", `/api/tickets/${t.id}`, { json: { statusId } })
    if (res.status !== 200) throw new HarnessBroken(`couldn't change the ticket status: ${res.status} ${errorText(res.text)}`)
    return ticketJson(res.text)
  }
  const stamps = (j: TicketJson) => `resolved ${j.resolvedAt ? "set" : "empty"}, closed ${j.closedAt ? "set" : "empty"}`
  try {
    const opened = t.statusChangedAt
    const resolved = await patch(fx.ticketResolvedStatusId)
    push("moving to Resolved sets resolvedAt", "resolved set, closed empty", stamps(resolved),
      !resolved.resolvedAt || resolved.closedAt ? "the dates are wrong" : resolved.statusChangedAt === opened ? "statusChangedAt didn't move" : null)
    const afterMove = await statusEntries()
    await patch(fx.ticketResolvedStatusId)
    const afterSame = await statusEntries()
    push("a move records one entry, no move records none", "1 then 1", `${afterMove} then ${afterSame}`, afterMove !== 1 || afterSame !== 1 ? "the entry count is wrong" : null)
    const closed = await patch(fx.ticketClosedStatusId)
    push("moving to Closed sets closedAt and keeps resolvedAt", "resolved kept, closed set", stamps(closed),
      !closed.closedAt ? "closedAt isn't set" : closed.resolvedAt !== resolved.resolvedAt ? "resolvedAt changed" : null)
    const reopened = await patch(fx.ticketOpenStatusId)
    push("moving back to Open clears both", "resolved empty, closed empty", stamps(reopened), reopened.resolvedAt || reopened.closedAt ? "a date is still set" : null)

    // A note that moves the status records the move on the note itself
    const before = await statusEntries()
    const note = await admin.request("POST", `/api/tickets/${t.id}/timeline`, { json: { body: TICKET_NOTE, statusId: fx.ticketWaitingStatusId } })
    const noteData = (ticketJson(note.text) as { data?: { statusChange?: { to?: { id?: string } } } }).data
    const waiting = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, select: { statusId: true, resolvedAt: true } })
    push("a note with a status moves it, recorded on the note", "200, on the note, no separate entry", String(note.status),
      note.status !== 200 ? errorText(note.text)
        : noteData?.statusChange?.to?.id !== fx.ticketWaitingStatusId ? "the note doesn't hold the move"
          : waiting.statusId !== fx.ticketWaitingStatusId ? "the status didn't move"
            : (await statusEntries()) !== before ? "a separate status_changed entry was written"
              : null)

    // The custom ticket button always moves to Resolved, with an optional note
    const button = await admin.request("POST", `/api/tickets/${t.id}/timeline`, { json: { body: "<p></p>", actionButtonId: fx.ticketButtonId } })
    const afterButton = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, select: { statusId: true, resolvedAt: true } })
    const buttonData = (ticketJson(button.text) as { data?: { actionButton?: { id?: string } } }).data
    push("an empty note through the fixed status button resolves it", "200, Resolved, resolvedAt set, button stored", String(button.status),
      button.status !== 200 ? errorText(button.text)
        : afterButton.statusId !== fx.ticketResolvedStatusId || !afterButton.resolvedAt ? "the ticket isn't resolved"
          : buttonData?.actionButton?.id !== fx.ticketButtonId ? "the entry doesn't name the button"
            : null)
    const wrong = await admin.request("POST", `/api/tickets/${t.id}/timeline`, { json: { body: TICKET_NOTE, actionButtonId: fx.ticketButtonId, statusId: fx.ticketOpenStatusId } })
    push("the fixed status button refuses another status", "400", String(wrong.status),
      wrong.status !== 400 || !errorText(wrong.text).includes("always moves to its own status") ? `got ${wrong.status}: ${errorText(wrong.text)}` : null)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: t.id } })
  }
}

// The audit flow: a field change is recorded and undone once, a deleted
// ticket leaves every list and route (and its undo waits for a restore),
// and a restore brings it back once
async function checkTicketAuditFlow(prisma: PrismaClient, admin: Session, basic: Session, ctx: AttemptContext, rows: Row[]) {
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[Admin B] Ticket audit: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const t = await newTicket(admin, ctx, { title: "Dev check ticket audit" })
  const fieldEntry = (field: string) =>
    prisma.auditLogEntry.findFirst({ where: { recordType: "TICKET", recordId: t.id, action: "field_changed", field }, orderBy: { createdAt: "desc" }, select: { id: true } })
  try {
    const created = await prisma.auditLogEntry.count({ where: { recordType: "TICKET", recordId: t.id, action: "created" } })
    const firstEntries = await prisma.timelineEntry.findMany({ where: { ticketId: t.id }, select: { kind: true, action: true } })
    push("creating records created entries and the initial note", "created audit, created action, one note", `${created} audit, ${firstEntries.length} entries`,
      created !== 1 ? "no created audit entry"
        : !firstEntries.some((e) => e.action === "created") || firstEntries.filter((e) => e.kind === "NOTE").length !== 1 ? "the timeline is missing the created action or the note"
          : null)

    const rename = await admin.request("PATCH", `/api/tickets/${t.id}`, { json: { title: "Dev check ticket audit renamed" } })
    const entry = await fieldEntry("title")
    if (rename.status !== 200 || !entry) throw new HarnessBroken(`couldn't rename the ticket: ${rename.status} ${errorText(rename.text)}`)
    const undo = await admin.request("POST", `/api/audit-log/${entry.id}/undo`)
    const back = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id }, select: { title: true } })
    // Exactly the title it was saved with, the sample client's prefix
    // included (the create response's title)
    push("undo puts the title back", "200, the old title", String(undo.status),
      undo.status !== 200 ? errorText(undo.text)
        : !t.title?.endsWith("Dev check ticket audit") ? `the create answered the title "${t.title}"`
          : back.title !== t.title ? "the title wasn't put back" : null)
    const again = await admin.request("POST", `/api/audit-log/${entry.id}/undo`)
    push("undo twice is refused", "409", String(again.status), again.status !== 409 ? errorText(again.text) : null)

    // A change, then a delete: gone everywhere, and its undo waits
    await admin.request("PATCH", `/api/tickets/${t.id}`, { json: { priorityId: ctx.fx.ticketPriorityIds[1] } })
    const priorityEntry = await fieldEntry("priorityId")
    const del = await admin.request("DELETE", `/api/tickets/${t.id}`)
    const gone = await Promise.all([
      admin.request("GET", `/api/tickets/${t.id}`),
      admin.request("GET", `/api/tickets/${t.id}/timeline`),
      admin.request("GET", `/api/tickets/${t.id}/attachments`),
      admin.request("PATCH", `/api/tickets/${t.id}`, { json: { title: "Should not change" } }),
      admin.request("POST", `/api/tickets/${t.id}/timeline`, { json: { body: TICKET_NOTE } }),
    ])
    const list = await basic.request("GET", "/api/tickets")
    push("a deleted ticket is gone from its routes and the list", "200, then 404 on every route, not listed", `${del.status}, ${gone.map((g) => g.status).join("/")}`,
      del.status !== 200 ? errorText(del.text) : gone.some((g) => g.status !== 404) ? "a route still answers" : list.text.includes(t.id) ? "Test Ticket Basic B still lists it" : null)
    const undoDeleted = priorityEntry ? await admin.request("POST", `/api/audit-log/${priorityEntry.id}/undo`) : null
    push("undo waits for a restore", "409 restore first", String(undoDeleted?.status ?? "no entry"),
      !undoDeleted ? "no priority change entry" : undoDeleted.status !== 409 || !errorText(undoDeleted.text).includes("Restore it first") ? errorText(undoDeleted.text) : null)

    const restore = await admin.request("POST", `/api/tickets/${t.id}/restore`)
    const restoredEntries = await prisma.timelineEntry.count({ where: { ticketId: t.id, action: "restored" } })
    const restoredAudit = await prisma.auditLogEntry.count({ where: { recordType: "TICKET", recordId: t.id, action: "restored" } })
    const open = await admin.request("GET", `/api/tickets/${t.id}`)
    push("restore brings it back once", "200, restored entries, opens again", `${restore.status}, ${open.status}`,
      restore.status !== 200 ? errorText(restore.text) : restoredEntries !== 1 || restoredAudit !== 1 ? "the restored entries are missing" : open.status !== 200 ? "it doesn't open" : null)
    const twice = await admin.request("POST", `/api/tickets/${t.id}/restore`)
    push("a second restore is refused", "409", String(twice.status), twice.status !== 409 ? errorText(twice.text) : null)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: t.id } })
  }
}

// The daily auto close job on Test Company B only (companyIds, so no other
// dev data is touched): a ticket resolved 10 days ago closes by System, one
// resolved yesterday and one with a customer reply since stay, a second run
// closes nothing, and with auto close off nothing closes. The cron route
// refuses without its secret (401, or 503 when the server has none).
async function checkTicketAutoClose(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[], baseUrl: string) {
  const companyId = ctx.b.companyId
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[System] Ticket auto close: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  // Imported here, after the guard, like the database client
  const { closeResolvedTickets } = await import("@/lib/ticket-autoclose-job")
  const DAY = 24 * 60 * 60 * 1000
  const resolvedId = ctx.fx.ticketResolvedStatusId
  const created: string[] = []
  const settings = await prisma.ticketSettings.findUniqueOrThrow({ where: { companyId }, select: { autoCloseResolvedDays: true } })
  try {
    await prisma.ticketSettings.update({ where: { companyId }, data: { autoCloseResolvedDays: 7 } })
    const resolve = async (title: string, daysAgo: number) => {
      const t = await newTicket(admin, ctx, { title })
      created.push(t.id)
      await prisma.ticket.update({ where: { id: t.id }, data: { statusId: resolvedId, resolvedAt: new Date(Date.now() - daysAgo * DAY), closedAt: null } })
      return t.id
    }
    const due = await resolve("Dev check auto close due", 10)
    const notDue = await resolve("Dev check auto close not due", 1)
    const replied = await resolve("Dev check auto close replied", 10)
    await prisma.timelineEntry.create({ data: { companyId, ticketId: replied, kind: "EMAIL_IN", body: "<p>Dev check reply</p>", createdAt: new Date(Date.now() - 5 * DAY) } })

    const startedAt = new Date()
    const first = await closeResolvedTickets({ companyIds: [companyId], limit: 200 })
    const states = await prisma.ticket.findMany({ where: { id: { in: created } }, select: { id: true, closedAt: true, status: { select: { category: true } } } })
    const category = (id: string) => states.find((s) => s.id === id)?.status.category
    push("only the overdue resolved ticket closes", "due CLOSED, not due and replied RESOLVED, no errors",
      `${category(due)}, ${category(notDue)}, ${category(replied)}, ${first.errors.length} errors`,
      first.errors.length > 0 ? `errors: ${first.errors.map((e) => e.error).join("; ")}`
        : category(due) !== "CLOSED" || category(notDue) !== "RESOLVED" || category(replied) !== "RESOLVED" ? "a ticket has the wrong status"
          : !states.find((s) => s.id === due)?.closedAt ? "closedAt isn't set"
            : first.items.length !== 1 || first.items[0].ticketId !== due ? `closed ${first.items.map((i) => i.number).join(", ") || "nothing"} in Test Company B`
              : null)

    const moved = await prisma.timelineEntry.findMany({ where: { ticketId: due, action: "status_changed", createdAt: { gte: startedAt } }, select: { authorId: true, data: true } })
    const reason = (moved[0]?.data as { reason?: unknown } | null)?.reason
    push("the timeline shows the move by System with its reason", "one status_changed, no author", `${moved.length} entries`,
      moved.length !== 1 ? "expected one status_changed entry" : moved[0].authorId ? "the entry has an author" : typeof reason !== "string" || !reason.startsWith("No customer reply") ? "the reason is missing" : null)
    const audit = await prisma.auditLogEntry.findFirst({ where: { recordType: "TICKET", recordId: due, action: "field_changed", field: "statusId", createdAt: { gte: startedAt } }, select: { actorId: true, actorName: true } })
    push("the audit log shows the move by System", "field_changed statusId by System", audit ? `by ${audit.actorName}` : "none",
      !audit ? "no audit entry" : audit.actorId !== null || audit.actorName !== "System" ? "the entry isn't by System" : null)

    const second = await closeResolvedTickets({ companyIds: [companyId], limit: 200 })
    push("a second run closes nothing new", "0 closed", `${second.closed} closed`, second.closed !== 0 || second.errors.length > 0 ? `closed ${second.closed}, ${second.errors.length} errors` : null)

    await prisma.ticketSettings.update({ where: { companyId }, data: { autoCloseResolvedDays: 0 } })
    await prisma.ticket.update({ where: { id: notDue }, data: { resolvedAt: new Date(Date.now() - 30 * DAY) } })
    const off = await closeResolvedTickets({ companyIds: [companyId], limit: 200 })
    push("with auto close off nothing closes", "0 closed", `${off.closed} closed`, off.closed !== 0 ? "a ticket closed" : null)

    const url = `${baseUrl}/api/cron/close-resolved-tickets`
    const noSecret = await fetchOrExplain(url, { redirect: "manual" }, "GET /api/cron/close-resolved-tickets")
    const wrongSecret = await fetchOrExplain(url, { redirect: "manual", headers: { Authorization: `Bearer dev-check-${Math.random().toString(16).slice(2)}` } }, "GET /api/cron/close-resolved-tickets")
    const bodies = [await noSecret.text(), await wrongSecret.text()]
    const configured = noSecret.status === 401
    const wanted = configured ? '{"error":"Unauthorized"}' : '{"error":"Not configured"}'
    push(`the cron route refuses without the secret (${configured ? "401, the server has CRON_SECRET" : "503, the server has no CRON_SECRET"})`,
      "401 or 503 with no details, both the same", `${noSecret.status}, ${wrongSecret.status}`,
      ![401, 503].includes(noSecret.status) || wrongSecret.status !== noSecret.status ? `got ${noSecret.status} without and ${wrongSecret.status} with a made up secret`
        : bodies.some((b) => b !== wanted) ? "the answer says more than it should"
          : null)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: { in: created } } })
    await prisma.ticketSettings.update({ where: { companyId }, data: { autoCloseResolvedDays: settings.autoCloseResolvedDays } })
  }
}

// A client that has a ticket can't be deleted (Ticket.clientId is ON DELETE
// RESTRICT). There is no client DELETE route, so this asks the database
// itself: inside one transaction that is always rolled back, it creates a
// client whose only dependent row is one ticket, tries to delete the
// client, and expects the foreign key refusal (P2003). Nothing is kept,
// whatever happens.
async function checkClientWithTicketRestricted(prisma: PrismaClient, ctx: AttemptContext, rows: Row[]) {
  class RollBack extends Error {}
  let code: string | null = null
  let deleted = false
  try {
    await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({ data: { companyId: ctx.b.companyId, name: `${ctx.names.client} (delete check)` }, select: { id: true } })
      await tx.ticket.create({
        data: {
          companyId: ctx.b.companyId,
          number: "DEV-CHECK-DELETE-0001",
          title: "Dev check client delete",
          clientId: client.id,
          teamId: ctx.b.helpdeskTeamId,
          typeId: ctx.b.ticketTypeId,
          priorityId: ctx.b.ticketPriorityId,
          statusId: ctx.b.ticketStatusId,
        },
        select: { id: true },
      })
      try {
        await tx.client.delete({ where: { id: client.id } })
        deleted = true
      } catch (err) {
        code = err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "unknown"
      }
      throw new RollBack()
    })
  } catch (err) {
    if (!(err instanceof RollBack)) throw err
  }
  rows.push({
    attempt: "[System] Deleting a client that has a ticket",
    expected: "refused by the database (P2003)",
    actual: deleted ? "deleted" : (code ?? "no answer"),
    result: !deleted && code === "P2003" ? "PASS" : "FAIL",
    note: deleted ? "the client was deleted (rolled back): Ticket.clientId isn't RESTRICT in this database, run the migration" : code === "P2003" ? undefined : `refused with ${code}`,
  })
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

// Runs every attempt against this run's data and returns the result (exit code 0
// all passed, 1 a FAIL or UNEXPECTED). A broken harness throws HarnessBroken.
export async function checkPermissions(prisma: PrismaClient, run: RunData, baseUrl: string): Promise<CheckResult> {
  const rows: Row[] = []

  const b = run.companies.B.ids
  const c = run.companies.C.ids
  const fx = run.companies.B.fixtures
  const fxC = run.companies.C.fixtures
  const names = run.companies.B.names

  // Safety: with no Microsoft credentials and no distributor turned on, a
  // quote email can't be sent and no real distributor can be reached from
  // these companies even if a refusal below were broken
  const external = await findExternalServices(prisma, [b.companyId, c.companyId])
  if (external) throw new HarnessBroken(external)
  const quotes = await prisma.quote.findMany({ where: { id: { in: [b.quoteId, fx.repQuoteId] } }, select: { status: true } })
  if (quotes.length !== 2 || quotes.some((q) => q.status !== "DRAFT")) {
    throw new HarnessBroken("The sample quotes must be drafts, so this run's data isn't as it was set up.")
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
    // The ad hoc purchase order line exists only for this run
    await prisma.pOLineItem.deleteMany({ where: { purchaseOrderId: fx.ordersPurchaseOrderId, name: names.untrackedPoLine } })
  }

  async function runChecks() {
    await setSenderMode("CREATOR", null)
    const sender = await ensureSenderFixture(prisma, run)
    const viewer = await ensureViewerFixture(prisma, run)
    const manager = await ensureManagerFixture(prisma, run)
    const auditViewer = await ensureAuditViewerFixture(prisma, run)
    const untrackedPoLineId = await ensureUntrackedPoLine(prisma, fx, names)
    const ctx: AttemptContext = {
      b,
      c,
      fx,
      fxC,
      names,
      namesC: run.companies.C.names,
      senderMailboxId: sender.mailboxId,
      repUserId: fx.repUserId,
      managerRoleId: manager.roleId,
      untrackedPoLineId,
      fakeId: "devonlynotarealid000000000",
    }

    // Sign in, once per user for the whole check
    const sessions: Record<Actor, Session> = {
      admin: new Session("Test Admin B", baseUrl),
      rep: new Session("Test Rep B", baseUrl),
      clerk: new Session("Test Clerk B", baseUrl),
      everyone: new Session("Test Everyone B", baseUrl),
      sender: new Session("Test Sender B", baseUrl),
      orders: new Session("Test Orders B", baseUrl),
      templater: new Session("Test Templater B", baseUrl),
      viewer: new Session("Test Viewer B", baseUrl),
      manager: new Session("Test Manager B", baseUrl),
      oppViewer: new Session("Test Opp Viewer B", baseUrl),
      oppSettings: new Session("Test Opp Settings B", baseUrl),
      teamBasic: new Session("Test Team Basic B", baseUrl),
      teamViewer: new Session("Test Team Viewer B", baseUrl),
      teamManager: new Session("Test Team Manager B", baseUrl),
      auditViewer: new Session("Test Audit Viewer B", baseUrl),
      ticketBasic: new Session("Test Ticket Basic B", baseUrl),
      ticketViewer: new Session("Test Ticket Viewer B", baseUrl),
      ticketDispatcher: new Session("Test Ticket Dispatcher B", baseUrl),
      ticketSettings: new Session("Test Ticket Settings B", baseUrl),
    }
    await run.credentials.signIn(sessions.admin, names.adminEmail)
    await run.credentials.signIn(sessions.rep, names.repEmail)
    await run.credentials.signIn(sessions.everyone, names.everyoneEmail)
    await run.credentials.signIn(sessions.clerk, names.clerkEmail)
    await run.credentials.signIn(sessions.sender, sender.email)
    await run.credentials.signIn(sessions.orders, names.ordersEmail)
    await run.credentials.signIn(sessions.templater, names.templaterEmail)
    await run.credentials.signIn(sessions.viewer, viewer.email)
    await run.credentials.signIn(sessions.manager, manager.email)
    await run.credentials.signIn(sessions.oppViewer, names.oppViewerEmail)
    await run.credentials.signIn(sessions.oppSettings, names.oppSettingsEmail)
    await run.credentials.signIn(sessions.teamBasic, names.teamBasicEmail)
    await run.credentials.signIn(sessions.teamViewer, names.teamViewerEmail)
    await run.credentials.signIn(sessions.teamManager, names.teamManagerEmail)
    await run.credentials.signIn(sessions.auditViewer, auditViewer.email)
    await run.credentials.signIn(sessions.ticketBasic, names.ticketBasicEmail)
    await run.credentials.signIn(sessions.ticketViewer, names.ticketViewerEmail)
    await run.credentials.signIn(sessions.ticketDispatcher, names.ticketDispatcherEmail)
    await run.credentials.signIn(sessions.ticketSettings, names.ticketSettingsEmail)
    console.log(
      `Signed in to ${baseUrl} as Test Admin B, Test Rep B, Test Clerk B, Test Everyone B, Test Sender B, Test Orders B, Test Templater B, Test Viewer B, Test Manager B, Test Opp Viewer B, Test Opp Settings B, Test Team Basic B, Test Team Viewer B, Test Team Manager B, Test Audit Viewer B, Test Ticket Basic B, Test Ticket Viewer B, Test Ticket Dispatcher B, and Test Ticket Settings B.`
    )

    const ACTOR_LABEL: Record<Actor, string> = {
      admin: "Admin B",
      rep: "Rep B",
      clerk: "Clerk B",
      everyone: "Everyone B",
      sender: "Sender B",
      orders: "Orders B",
      templater: "Templater B",
      viewer: "Viewer B",
      manager: "Manager B",
      oppViewer: "Opp Viewer B",
      oppSettings: "Opp Settings B",
      teamBasic: "Team Basic B",
      teamViewer: "Team Viewer B",
      teamManager: "Team Manager B",
      auditViewer: "Audit Viewer B",
      ticketBasic: "Ticket Basic B",
      ticketViewer: "Ticket Viewer B",
      ticketDispatcher: "Ticket Dispatcher B",
      ticketSettings: "Ticket Settings B",
    }
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
          // The server stopped answering: no later attempt can run either
          if (err instanceof ServerUnreachable) throw err
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

    // Round two: a manual status change needs approval (N-1), a quote
    // changed after approval was requested is not sent (N-2), and a sales
    // order shows only the purchase orders the user may open (#56)
    await checkStatusApproval(prisma, sessions.admin, ctx, rows)
    const approverFixture = await ensureApproverFixture(prisma, run)
    const approver = new Session("Test Approver B", baseUrl)
    await run.credentials.signIn(approver, approverFixture.email)
    await checkStaleApproval(prisma, sessions.admin, approver, approverFixture.roleId, ctx, rows)
    await checkSalesOrderLinkedPurchaseOrders(prisma, sessions.admin, sessions.orders, ctx, rows)

    // Quote correctness: copies reproduce every line and get the chosen client
    await checkQuoteCopy(prisma, sessions.admin, sessions.rep, ctx, rows)

    // Opportunities screens: page guards, the Related panel's visibility,
    // and closedAt following a stage's category
    await checkOpportunityPages(sessions, ACTOR_LABEL, ctx, rows)
    await checkRelatedVisibility(prisma, sessions, ACTOR_LABEL, ctx, rows)
    await checkStageCategoryClosedAt(prisma, sessions.oppSettings, ctx, rows)
    await checkTimeline(prisma, sessions.admin, ctx, rows)
    await checkNoteStageChange(prisma, sessions.admin, ctx, rows)
    await checkOpportunityLocation(prisma, sessions.admin, ctx, rows)

    // Action buttons: fixed stage buttons move the stage with one entry,
    // and hidden or unavailable buttons stay off records
    await checkActionButtonNotes(prisma, sessions.admin, ctx, rows)
    await checkRecordButtonList(prisma, sessions.admin, sessions.oppViewer, ctx, rows)

    // Quotes linked to opportunities: linking, the automatic opportunity,
    // stage events, the value, and links carried to orders
    await checkQuoteOpportunities(prisma, sessions, ctx, rows)

    // When an opportunity is created, Create opportunity stages, and the
    // client change rule
    await checkQuoteOpportunityRules(prisma, sessions, ctx, rows)

    // The daily quote expiry job, on Test Company B only, and the cron
    // route refusing without its secret
    await checkQuoteExpiryJob(prisma, sessions.admin, ctx, rows, baseUrl)

    // Audit log: every action recorded, soft delete and restore, and undo
    const auditOpportunityId = await checkAuditRecording(prisma, sessions.admin, ctx, rows)
    if (auditOpportunityId) {
      try {
        await checkSoftDelete(prisma, sessions.admin, sessions.oppViewer, ctx, rows, auditOpportunityId)
        await checkAuditUndo(prisma, sessions.admin, ctx, rows, auditOpportunityId)
      } finally {
        await prisma.opportunity.deleteMany({ where: { id: auditOpportunityId } })
      }
    }

    // Teams: default roles applied on the next request, and team changes
    await checkTeamDefaultRoles(prisma, sessions.admin, sessions.everyone, ctx, rows)
    await checkTeamChange(prisma, sessions.admin, ctx, rows)
    await checkGrantRules(prisma, sessions.teamManager, sessions.manager, ctx, rows)

    // Record numbers: parallel creates never share a number, and a delete
    // never gives one back
    await checkRecordNumbering(prisma, sessions.admin, ctx, rows)

    // Appearance: each user reads and saves only their own preferences, bad
    // values are refused, personal colors can be turned off, and the company
    // defaults need the company settings permission
    await checkAppearancePreferences(prisma, sessions, ctx, rows)

    // Sidebar layouts: the company layout needs the company settings
    // permission, each user saves and resets only their own, bad values are
    // refused, and personal layouts can be turned off
    await checkSidebarPreferences(prisma, sessions, ctx, rows)

    // Company logos: removing one needs the upload permission, clears it,
    // and the portal and quote PDFs still render without it
    await checkLogoRemoval(prisma, sessions, ctx, rows)

    // Client prefixes: new ticket and opportunity titles start with the
    // client's prefix
    await checkClientTitlePrefix(prisma, sessions.admin, ctx, rows)

    // Tickets: round robin in rotation, status timestamps, the audit flow
    // (undo, delete, restore), and the daily auto close job on Test Company B only
    await checkTicketRoundRobin(prisma, sessions.admin, ctx, rows)
    await checkTicketStatusTimestamps(prisma, sessions.admin, ctx, rows)
    await checkTicketAuditFlow(prisma, sessions.admin, sessions.ticketBasic, ctx, rows)
    await checkTicketAutoClose(prisma, sessions.admin, ctx, rows, baseUrl)
    await checkClientWithTicketRestricted(prisma, ctx, rows)

    // The ticket screens: page access and the in-app notification an
    // assignment sends
    await checkTicketPages(sessions, ACTOR_LABEL, ctx, rows)
    await checkTicketAssignmentNotifications(prisma, sessions, ctx, rows)

    // Attachment downloads: the parent's view check, the redirect, and no
    // bucket link in any attachment response
    await checkAttachmentDownloads(prisma, sessions, ACTOR_LABEL, ctx, rows)

    printTable(rows)
    const count = (r: Row["result"]) => rows.filter((row) => row.result === r).length
    console.log(`\n${rows.length} checks: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("UNEXPECTED")} UNEXPECTED`)

    return checkResult(rows)
  }
}

// Attachment downloads (GET /api/files/<kind>/<id>): a user who may view
// the parent record gets a 302 to the uploads bucket with a link that
// expires within 300 seconds; one who may not gets the parent's refusal
// (403 without the page, 404 for a record they can't open); a soft
// deleted opportunity's attachment is a 404; a dummy example.test link is
// a 404 "File not available" with no redirect; and no attachment API
// response carries the bucket host or a stored file link. Each
// downloadFileIds attachment has a link in the bucket's URL format and a
// test key with no file behind it (presigning never contacts S3). The
// redirect's link is never printed, only its host and expiry.
async function checkAttachmentDownloads(prisma: PrismaClient, sessions: Record<Actor, Session>, labels: Record<Actor, string>, ctx: AttemptContext, rows: Row[]) {
  const push = (actor: Actor, name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[${labels[actor]}] Attachment download: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  if (!process.env.AWS_S3_BUCKET_NAME || !process.env.AWS_REGION) {
    rows.push({
      attempt: "Attachment downloads",
      expected: "AWS_S3_BUCKET_NAME and AWS_REGION set",
      actual: "missing",
      result: "UNEXPECTED",
      note: "Set AWS_S3_BUCKET_NAME and AWS_REGION in .env.development.local (the same values the dev server uses), so the download fixtures use the bucket's URL format",
    })
    return
  }
  const { bucketBaseUrl } = await import("@/lib/uploads")
  const bucketHost = new URL(bucketBaseUrl()).host
  const files = ctx.b.downloadFileIds
  const path = (kind: AttachmentKind, id = files[kind]) => `/api/files/${kind}/${id}`

  const redirects = async (actor: Actor, kind: AttachmentKind) => {
    const res = await sessions[actor].request("GET", path(kind))
    let problem: string | null = null
    if (res.status !== 302) problem = `got ${res.status}: ${errorText(res.text)}`
    else {
      try {
        const link = new URL(res.location)
        const expires = Number(link.searchParams.get("X-Amz-Expires"))
        if (link.host !== bucketHost) problem = `redirected to ${link.host}, not the uploads bucket`
        else if (!link.searchParams.get("X-Amz-Signature")) problem = "the link isn't signed"
        else if (!Number.isFinite(expires) || expires <= 0 || expires > 300) problem = `the link expires in ${link.searchParams.get("X-Amz-Expires") ?? "no set time"}, not at most 300 seconds`
      } catch {
        problem = "the redirect has no usable link"
      }
    }
    push(actor, `${kind} attachment it may view`, "302 to the bucket, at most 300 seconds", String(res.status), problem)
  }
  const refused = async (actor: Actor, kind: AttachmentKind, expect: 403 | 404, expectError: string, why: string) => {
    const res = await sessions[actor].request("GET", path(kind))
    const problem =
      res.status !== expect ? `got ${res.status}${res.location ? " with a redirect" : ""}`
        : res.location ? "redirected anyway"
          : !isJsonError(res.text) || !errorText(res.text).includes(expectError) ? `refused for another reason: ${errorText(res.text)}`
            : null
    push(actor, `${kind} attachment ${why}`, `${expect} "${expectError}"`, String(res.status), problem)
  }

  // Allowed: the admin for every kind, the clerk for vendors and assets,
  // and the viewer (both order pages and both viewAll keys) for orders
  for (const kind of ATTACHMENT_KINDS) await redirects("admin", kind)
  await redirects("clerk", "vendor")
  await redirects("clerk", "inventory-asset")
  await redirects("viewer", "sales-order")
  await redirects("viewer", "purchase-order")
  await redirects("ticketBasic", "ticket")

  // Refused: without the page (403), or a record the user can't open (404)
  const pageRefusal: Record<AttachmentKind, string> = {
    vendor: "view vendors",
    "inventory-asset": "view inventory",
    "sales-order": "view sales orders",
    "purchase-order": "view purchase orders",
    opportunity: "view opportunities",
    ticket: "view tickets",
  }
  for (const kind of ATTACHMENT_KINDS) await refused("everyone", kind, 403, pageRefusal[kind], "without the page")
  await refused("oppViewer", "ticket", 403, pageRefusal.ticket, "without the page")
  await refused("ticketSettings", "ticket", 403, pageRefusal.ticket, "without the page")
  await refused("rep", "vendor", 403, pageRefusal.vendor, "without the page")
  await refused("rep", "sales-order", 403, pageRefusal["sales-order"], "without the page")
  await refused("clerk", "opportunity", 403, pageRefusal.opportunity, "without the page")
  await refused("orders", "sales-order", 404, "Not found", "on another user's sales order")
  await refused("orders", "purchase-order", 404, "Not found", "on another user's purchase order")
  await refused("rep", "opportunity", 404, "Not found", "on an opportunity it can't open")
  await refused("oppViewer", "opportunity", 404, "Not found", "on an opportunity it can't open")

  // A soft deleted opportunity's attachment, even for an audit log viewer
  // (deletedAt written directly and cleared right after)
  const opportunityId = ctx.b.opportunityId
  try {
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { deletedAt: new Date(), deletedById: ctx.b.adminId } })
    await refused("admin", "opportunity", 404, "Not found", "on a deleted opportunity")
  } finally {
    await prisma.opportunity.update({ where: { id: opportunityId }, data: { deletedAt: null, deletedById: null } })
  }
  // The same for a soft deleted ticket
  try {
    await prisma.ticket.update({ where: { id: ctx.b.ticketId }, data: { deletedAt: new Date(), deletedById: ctx.b.adminId } })
    await refused("admin", "ticket", 404, "Not found", "on a deleted ticket")
  } finally {
    await prisma.ticket.update({ where: { id: ctx.b.ticketId }, data: { deletedAt: null, deletedById: null } })
  }

  // The sample attachments' dummy example.test link: not available, never redirected
  const dummies: [AttachmentKind, string][] = [
    ["vendor", ctx.b.vendorAttachmentId],
    ["sales-order", ctx.b.soAttachmentId],
    ["purchase-order", ctx.b.poAttachmentId],
    ["inventory-asset", ctx.b.assetAttachmentId],
    ["opportunity", ctx.b.opportunityAttachmentId],
    ["ticket", ctx.b.ticketAttachmentId],
  ]
  for (const [kind, id] of dummies) {
    const res = await sessions.admin.request("GET", path(kind, id))
    const problem =
      res.status !== 404 ? `got ${res.status}${res.location ? " with a redirect" : ""}`
        : res.location ? "redirected anyway"
          : errorText(res.text) !== "File not available" ? `got "${errorText(res.text)}"`
            : null
    push("admin", `${kind} attachment with a dummy example.test link`, '404 "File not available"', String(res.status), problem)
  }

  // No attachment API response carries the bucket host or a stored link,
  // and each lists its download fixture by its download route
  const responses: { name: string; path: string; kind: AttachmentKind }[] = [
    { name: "vendor attachments", path: `/api/vendors/${ctx.b.vendorId}/attachments`, kind: "vendor" },
    { name: "sales order attachments", path: `/api/sales-orders/${ctx.b.salesOrderId}/attachments`, kind: "sales-order" },
    { name: "purchase order attachments", path: `/api/purchase-orders/${ctx.b.purchaseOrderId}/attachments`, kind: "purchase-order" },
    { name: "purchase order detail", path: `/api/purchase-orders/${ctx.b.purchaseOrderId}`, kind: "purchase-order" },
    { name: "asset attachments", path: `/api/inventory-assets/${ctx.b.assetId}/attachments`, kind: "inventory-asset" },
    { name: "opportunity attachments", path: `/api/opportunities/${ctx.b.opportunityId}/attachments`, kind: "opportunity" },
    { name: "ticket attachments", path: `/api/tickets/${ctx.b.ticketId}/attachments`, kind: "ticket" },
  ]
  for (const r of responses) {
    const res = await sessions.admin.request("GET", r.path)
    const route = attachmentDownloadPath(r.kind, files[r.kind])
    const problem =
      res.status !== 200 ? `got ${res.status}: ${errorText(res.text)}`
        : res.text.includes(bucketHost) || res.text.includes("amazonaws.com") ? "the response holds the bucket host"
          : res.text.includes('"fileUrl"') ? "the response holds a stored file link"
            : !res.text.includes(`"downloadUrl":"${route}"`) ? "the download fixture isn't listed with its download route"
              : null
    push("admin", `${r.name} hold no bucket link`, "200, download routes only", String(res.status), problem)
  }
}

// Parallel creates get distinct numbers in the usual format, one after
// another, and a delete never gives a number back (NumberSequence and
// takeNextNumber in src/lib/record-number.ts)
async function checkRecordNumbering(prisma: PrismaClient, admin: Session, ctx: AttemptContext, rows: Row[]) {
  const label = (name: string) => `[Admin B] Record numbers: ${name}`
  const push = (name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: label(name), expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const settings = await prisma.companySettings.findUnique({ where: { companyId: ctx.b.companyId } })
  const year = new Date().getFullYear()
  const PARALLEL = 6
  const kinds = [
    { name: "quotes", path: "/api/quotes", field: "quoteNumber", prefix: settings?.quotePrefix ?? "Q", body: { clientId: ctx.b.clientId, contactId: ctx.b.contactId } },
    { name: "sales orders", path: "/api/sales-orders", field: "soNumber", prefix: settings?.soPrefix ?? "SO", body: { clientId: ctx.b.clientId } },
    { name: "purchase orders", path: "/api/purchase-orders", field: "poNumber", prefix: settings?.poPrefix ?? "PO", body: { vendorId: ctx.b.vendorId } },
  ] as const
  type Kind = (typeof kinds)[number]
  const created: Record<Kind["name"], string[]> = { quotes: [], "sales orders": [], "purchase orders": [] }

  const make = async (kind: Kind) => {
    const res = await admin.request("POST", kind.path, { json: kind.body })
    const body = res.status === 200 ? (JSON.parse(res.text) as Record<string, unknown>) : null
    const id = typeof body?.id === "string" ? body.id : null
    const number = typeof body?.[kind.field] === "string" ? (body[kind.field] as string) : null
    if (id) created[kind.name].push(id)
    return { status: res.status, text: res.text, id, number }
  }
  // The prefix may hold hyphens; the sequence is what follows the last one
  const sequenceOf = (number: string) => Number(number.slice(number.lastIndexOf("-") + 1))
  const matchesFormat = (number: string, prefix: string) =>
    number.startsWith(`${prefix}-${year}-`) && /^\d{4,}$/.test(number.slice(`${prefix}-${year}-`.length))

  try {
    for (const kind of kinds) {
      const results = await Promise.all(Array.from({ length: PARALLEL }, () => make(kind)))
      const failed = results.find((r) => r.status !== 200 || !r.number || !r.id)
      const numbers = results.map((r) => r.number ?? "")
      const sequences = numbers.map(sequenceOf).sort((a, b) => a - b)
      push(`${PARALLEL} ${kind.name} created at once get different numbers`, `${PARALLEL} distinct`, `${new Set(numbers).size} distinct`,
        failed ? `got ${failed.status}: ${errorText(failed.text)}` : new Set(numbers).size !== PARALLEL ? `numbers ${numbers.join(", ")}` : null)
      if (failed) continue
      push(`${kind.name} numbers follow ${kind.prefix}-${year}-NNNN`, `${kind.prefix}-${year}-NNNN`, numbers.join(", "),
        numbers.every((n) => matchesFormat(n, kind.prefix)) ? null : `numbers ${numbers.join(", ")}`)
      push(`${kind.name} numbers are one after another`, "consecutive", sequences.join(", "),
        sequences.every((n, i) => i === 0 || n === sequences[i - 1] + 1) ? null : `sequences ${sequences.join(", ")}`)

      // Delete the newest, then create one more: its number comes after it
      const highest = sequences[sequences.length - 1]
      const newest = results.find((r) => sequenceOf(r.number ?? "") === highest)!
      const del = await admin.request("DELETE", `${kind.path}/${newest.id}`)
      if (del.status === 200) created[kind.name] = created[kind.name].filter((id) => id !== newest.id)
      const next = await make(kind)
      push(`after deleting the newest of the ${kind.name}, its number is not reused`, `delete 200, then sequence ${highest + 1}`,
        `delete ${del.status}, then ${next.number ?? next.status}`,
        del.status !== 200 ? `delete got ${del.status}: ${errorText(del.text)}`
          : !next.number ? `create got ${next.status}: ${errorText(next.text)}`
            : next.number === newest.number || sequenceOf(next.number) !== highest + 1 ? `got ${next.number} after deleting ${newest.number}` : null)
    }
  } finally {
    await prisma.quote.deleteMany({ where: { id: { in: created.quotes } } })
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: created["purchase orders"] } } })
    await prisma.salesOrder.deleteMany({ where: { id: { in: created["sales orders"] } } })
  }
}

// On its own: this check's own temporary data, set up and removed around it
async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  return withRunData("check-permissions", (prisma, run) => checkPermissions(prisma, run, baseUrl))
}

if (isEntryScript("check-permissions")) {
  main()
    .then((result) => process.exit(result.code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(err instanceof HarnessBroken ? 2 : 1)
    })
}

// My settings > Appearance (PATCH /api/account/preferences) and the company
// defaults (/api/company-settings/appearance). Test Everyone B saves its own
// colors and row density (a body naming Test Admin B is ignored), bad hex and
// enum values are refused with nothing written, Test Manager B (no company
// settings permission) can't change the company defaults, and with personal
// colors turned off a color change is refused while row density still
// saves. Everything is put back.
async function checkAppearancePreferences(prisma: PrismaClient, sessions: Record<Actor, Session>, ctx: AttemptContext, rows: Row[]) {
  const push = (who: string, name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[${who}] Appearance: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const everyoneId = ctx.fx.everyoneUserId
  const adminId = ctx.b.adminId
  const prefsOf = (userId: string) => prisma.userPreferences.findUnique({ where: { userId } })
  const companySelect = { themeAccent: true, themeSidebar: true, themeMode: true, allowUserTheme: true } as const
  const savedCompany = await prisma.companySettings.findUnique({ where: { companyId: ctx.b.companyId }, select: companySelect })
  const savedEveryone = await prefsOf(everyoneId)
  const savedAdmin = JSON.stringify(await prefsOf(adminId))
  const everyone = sessions.everyone

  try {
    // Own row, saved and read back; the body's userId means nothing
    let res = await everyone.request("PATCH", "/api/account/preferences", {
      json: { themeAccent: "#2563eb", themeSidebar: "TINTED", themeMode: "DARK", rowDensity: "COMPACT", userId: adminId },
    })
    let row = await prefsOf(everyoneId)
    push(
      "Everyone B",
      "save own colors and density",
      "200, saved on own row",
      String(res.status),
      res.status !== 200
        ? `got ${res.status}: ${errorText(res.text)}`
        : row?.themeAccent !== "#2563EB" || row.themeSidebar !== "TINTED" || row.themeMode !== "DARK" || row.rowDensity !== "COMPACT"
          ? "the saved row does not hold the new values"
          : JSON.stringify(await prefsOf(adminId)) !== savedAdmin
            ? "Test Admin B's preferences changed"
            : null
    )
    res = await everyone.request("GET", "/api/account/preferences")
    push("Everyone B", "read own preferences", "200, own values", String(res.status), res.status !== 200 ? `got ${res.status}` : !res.text.includes("#2563EB") || !res.text.includes("COMPACT") ? "own values missing" : null)

    // Bad values: 400 and nothing written
    const bad: [string, Record<string, unknown>][] = [
      ["three digit hex", { themeAccent: "#FFF" }],
      ["named color", { themeAccent: "red" }],
      ["lower case sidebar", { themeSidebar: "dark" }],
      ["unknown mode", { themeMode: "AUTO" }],
      ["unknown density", { rowDensity: "TIGHT" }],
    ]
    for (const [name, body] of bad) {
      const before = JSON.stringify(await prefsOf(everyoneId))
      res = await everyone.request("PATCH", "/api/account/preferences", { json: body })
      const changed = JSON.stringify(await prefsOf(everyoneId)) !== before
      push("Everyone B", `refuse ${name}`, "400", String(res.status), res.status !== 400 ? `got ${res.status}: ${errorText(res.text)}` : changed ? "data changed" : null)
    }

    // The company defaults need settingsSections.company
    res = await sessions.manager.request("PATCH", "/api/company-settings/appearance", { json: { allowUserTheme: false } })
    const afterManager = await prisma.companySettings.findUnique({ where: { companyId: ctx.b.companyId }, select: companySelect })
    push(
      "Manager B",
      "refuse company appearance",
      "403",
      String(res.status),
      res.status !== 403 ? `got ${res.status}: ${errorText(res.text)}` : JSON.stringify(afterManager) !== JSON.stringify(savedCompany) ? "company appearance changed" : null
    )

    // Personal colors off: colors refused, row density still saves
    res = await sessions.admin.request("PATCH", "/api/company-settings/appearance", { json: { allowUserTheme: false, themeAccent: "#475569" } })
    push("Admin B", "turn personal colors off", "200", String(res.status), res.status !== 200 ? `got ${res.status}: ${errorText(res.text)}` : null)
    const lockedBefore = JSON.stringify(await prefsOf(everyoneId))
    res = await everyone.request("PATCH", "/api/account/preferences", { json: { themeAccent: "#DC2626" } })
    push(
      "Everyone B",
      "color change refused while turned off",
      "403 THEME_LOCKED",
      String(res.status),
      res.status !== 403 || !res.text.includes("THEME_LOCKED")
        ? `got ${res.status}: ${errorText(res.text)}`
        : JSON.stringify(await prefsOf(everyoneId)) !== lockedBefore
          ? "data changed"
          : null
    )
    res = await everyone.request("GET", "/api/account/preferences")
    push(
      "Everyone B",
      "sees the company theme while turned off",
      "200, company accent",
      String(res.status),
      res.status !== 200 ? `got ${res.status}` : !res.text.includes('"theme":{"accent":"#475569"') ? "the resolved theme is not the company's" : null
    )
    res = await everyone.request("PATCH", "/api/account/preferences", { json: { rowDensity: "COMFORTABLE" } })
    row = await prefsOf(everyoneId)
    push(
      "Everyone B",
      "row density still saves while turned off",
      "200",
      String(res.status),
      res.status !== 200 ? `got ${res.status}: ${errorText(res.text)}` : row?.rowDensity !== "COMFORTABLE" ? "row density not saved" : null
    )
  } finally {
    await prisma.companySettings.updateMany({
      where: { companyId: ctx.b.companyId },
      data: {
        themeAccent: savedCompany?.themeAccent ?? null,
        themeSidebar: savedCompany?.themeSidebar ?? null,
        themeMode: savedCompany?.themeMode ?? null,
        allowUserTheme: savedCompany?.allowUserTheme ?? true,
      },
    })
    if (savedEveryone) {
      const { themeAccent, themeSidebar, themeMode, rowDensity } = savedEveryone
      await prisma.userPreferences.update({ where: { userId: everyoneId }, data: { themeAccent, themeSidebar, themeMode, rowDensity } })
    } else {
      await prisma.userPreferences.deleteMany({ where: { userId: everyoneId } })
    }
  }
}

// Sidebar layouts (/api/company-settings/sidebar and /api/account/sidebar).
// Test Admin B saves the company layout (unknown pages and a made up or
// foreign team dropped) and resets it; Test Manager B (no company settings
// permission) is refused; bad values are refused with 400; Test Everyone B
// saves, reads, and resets its own layout (never anyone else's), and is
// refused with 403 SIDEBAR_LOCKED while the company switch is off, when it
// sees the company layout but may still reset its own. Everything is put
// back.
async function checkSidebarPreferences(prisma: PrismaClient, sessions: Record<Actor, Session>, ctx: AttemptContext, rows: Row[]) {
  const push = (who: string, name: string, expected: string, actual: string, problem: string | null) =>
    rows.push({ attempt: `[${who}] Sidebar: ${name}`, expected, actual, result: problem ? "FAIL" : "PASS", note: problem ?? undefined })
  const everyoneId = ctx.fx.everyoneUserId
  const adminId = ctx.b.adminId
  const companySelect = { sidebarLayout: true, allowUserSidebar: true } as const
  const companyNow = () => prisma.companySettings.findUnique({ where: { companyId: ctx.b.companyId }, select: companySelect })
  const prefsOf = (userId: string) => prisma.userPreferences.findUnique({ where: { userId }, select: { sidebarLayout: true } })
  const savedCompany = await companyNow()
  const savedEveryone = await prefsOf(everyoneId)
  const savedAdmin = JSON.stringify(await prefsOf(adminId))
  const everyone = sessions.everyone
  const admin = sessions.admin
  // The stored layout as plain data
  type Stored = { sections?: Record<string, string[]>; folders?: Record<string, { teamOrder?: string[]; openByDefault?: boolean }>; defaultViews?: Record<string, string> }
  const stored = (value: unknown) => (value && typeof value === "object" ? (value as Stored) : null)
  const status = (res: { status: number; text: string }, want: number) => (res.status !== want ? `got ${res.status}: ${errorText(res.text)}` : null)

  try {
    // ── Company layout ──
    let res = await admin.request("PATCH", "/api/company-settings/sidebar", {
      json: {
        allowUserSidebar: true,
        layout: {
          sections: { work: ["opportunities", "made-up-page", "dashboard", "tickets"], notASection: ["dashboard"] },
          folders: { tickets: { teamOrder: [ctx.b.salesTeamId, ctx.fakeId, ctx.c.generalTeamId, ctx.b.generalTeamId], openByDefault: true } },
          defaultViews: { tickets: "mine", opportunities: "list" },
        },
        companyId: ctx.c.companyId,
      },
    })
    let company = await companyNow()
    let layout = stored(company?.sidebarLayout)
    push(
      "Admin B",
      "save the company layout",
      "200, unknown keys and foreign teams dropped",
      String(res.status),
      status(res, 200) ??
        (JSON.stringify(layout?.sections) !== JSON.stringify({ work: ["opportunities", "dashboard", "tickets"] })
          ? `stored sections are ${JSON.stringify(layout?.sections)}`
          : JSON.stringify(layout?.folders?.tickets) !== JSON.stringify({ teamOrder: [ctx.b.salesTeamId, ctx.b.generalTeamId], openByDefault: true })
            ? `stored tickets folder is ${JSON.stringify(layout?.folders?.tickets)}`
            : layout?.defaultViews?.tickets !== "mine" || layout?.defaultViews?.opportunities !== "list"
              ? "default views not saved"
              : null)
    )
    res = await admin.request("GET", "/api/company-settings/sidebar")
    push(
      "Admin B",
      "read the company layout",
      "200, saved order and own teams",
      String(res.status),
      status(res, 200) ??
        (!res.text.includes('"work":["opportunities","dashboard","tickets"]')
          ? "the saved order is not the effective one"
          : !res.text.includes(ctx.b.generalTeamId)
            ? "its own teams are missing"
            : res.text.includes(ctx.c.generalTeamId)
              ? "the response holds Test Company C's team"
              : null)
    )

    // The company layout needs settingsSections.company
    const beforeManager = JSON.stringify(await companyNow())
    res = await sessions.manager.request("PATCH", "/api/company-settings/sidebar", { json: { allowUserSidebar: false } })
    push("Manager B", "refuse saving the company layout", "403", String(res.status), status(res, 403) ?? (JSON.stringify(await companyNow()) !== beforeManager ? "the company layout changed" : null))
    res = await sessions.manager.request("DELETE", "/api/company-settings/sidebar")
    push("Manager B", "refuse resetting the company layout", "403", String(res.status), status(res, 403) ?? (JSON.stringify(await companyNow()) !== beforeManager ? "the company layout changed" : null))

    // Bad company values: 400 and nothing written
    const badCompany: [string, Record<string, unknown>][] = [
      ["an unknown ticket view", { layout: { defaultViews: { tickets: "everything" } } }],
      ["an unknown opportunity view", { layout: { defaultViews: { opportunities: "calendar" } } }],
      ["a switch that isn't true or false", { allowUserSidebar: "no" }],
      ["a section that isn't a list", { layout: { sections: { work: "tickets" } } }],
      ["a team id that isn't an id", { layout: { folders: { tickets: { teamOrder: ["not an id!"] } } } }],
      ["a layout that isn't an object", { layout: "board" }],
    ]
    for (const [name, body] of badCompany) {
      const before = JSON.stringify(await companyNow())
      res = await admin.request("PATCH", "/api/company-settings/sidebar", { json: body })
      push("Admin B", `refuse ${name}`, "400", String(res.status), status(res, 400) ?? (JSON.stringify(await companyNow()) !== before ? "data changed" : null))
    }

    // ── A user's own layout ──
    res = await everyone.request("PATCH", "/api/account/sidebar", {
      json: { layout: { defaultViews: { tickets: "waiting" }, folders: { opportunities: { openByDefault: true } } }, userId: adminId },
    })
    let own = stored((await prefsOf(everyoneId))?.sidebarLayout)
    push(
      "Everyone B",
      "save own layout",
      "200, saved on own row",
      String(res.status),
      status(res, 200) ??
        (own?.defaultViews?.tickets !== "waiting" || own?.folders?.opportunities?.openByDefault !== true
          ? `stored layout is ${JSON.stringify(own)}`
          : JSON.stringify(await prefsOf(adminId)) !== savedAdmin
            ? "Test Admin B's layout changed"
            : null)
    )
    res = await everyone.request("GET", "/api/account/sidebar")
    push(
      "Everyone B",
      "read own layout over the company's",
      "200, own view and the company order",
      String(res.status),
      status(res, 200) ??
        (!res.text.includes('"effective":{"sections":{"work":["opportunities","dashboard","tickets"]')
          ? "the company order is not in effect"
          : !/"effective":.*"tickets":"waiting"/.test(res.text)
            ? "its own ticket view is not in effect"
            : null)
    )

    // Bad user values: 400 and nothing written
    const badUser: [string, unknown][] = [
      ["no layout", { defaultViews: { tickets: "mine" } }],
      ["an unknown ticket view", { layout: { defaultViews: { tickets: "everything" } } }],
      ["an open switch that isn't true or false", { layout: { folders: { tickets: { openByDefault: "yes" } } } }],
      ["a body that isn't an object", ["layout"]],
    ]
    for (const [name, body] of badUser) {
      const before = JSON.stringify(await prefsOf(everyoneId))
      res = await everyone.request("PATCH", "/api/account/sidebar", { json: body })
      push("Everyone B", `refuse ${name}`, "400", String(res.status), status(res, 400) ?? (JSON.stringify(await prefsOf(everyoneId)) !== before ? "data changed" : null))
    }

    // ── Company switch off ──
    res = await admin.request("PATCH", "/api/company-settings/sidebar", { json: { allowUserSidebar: false } })
    company = await companyNow()
    push(
      "Admin B",
      "turn personal layouts off",
      "200, layout kept",
      String(res.status),
      status(res, 200) ?? (company?.allowUserSidebar !== false ? "the switch is still on" : stored(company?.sidebarLayout)?.defaultViews?.tickets !== "mine" ? "the company layout changed" : null)
    )
    const lockedBefore = JSON.stringify(await prefsOf(everyoneId))
    res = await everyone.request("PATCH", "/api/account/sidebar", { json: { layout: { defaultViews: { tickets: "all" } } } })
    push(
      "Everyone B",
      "saving refused while turned off",
      "403 SIDEBAR_LOCKED",
      String(res.status),
      res.status !== 403 || !res.text.includes("SIDEBAR_LOCKED")
        ? `got ${res.status}: ${errorText(res.text)}`
        : JSON.stringify(await prefsOf(everyoneId)) !== lockedBefore
          ? "data changed"
          : null
    )
    res = await everyone.request("GET", "/api/account/sidebar")
    push(
      "Everyone B",
      "sees the company layout while turned off",
      "200, company views",
      String(res.status),
      status(res, 200) ?? (!res.text.includes('"allowUserSidebar":false') ? "the switch is not reported off" : !/"effective":.*"tickets":"mine"/.test(res.text) ? "its own layout is still in effect" : null)
    )
    res = await everyone.request("DELETE", "/api/account/sidebar")
    own = stored((await prefsOf(everyoneId))?.sidebarLayout)
    push("Everyone B", "reset own layout, allowed while turned off", "200, own layout cleared", String(res.status), status(res, 200) ?? (own !== null ? "its own layout is still stored" : null))

    // ── Company reset ──
    res = await admin.request("DELETE", "/api/company-settings/sidebar")
    company = await companyNow()
    layout = stored(company?.sidebarLayout)
    push(
      "Admin B",
      "reset the company layout to the PSAsync default",
      "200, layout cleared, switch kept",
      String(res.status),
      status(res, 200) ??
        (layout !== null
          ? "the company layout is still stored"
          : company?.allowUserSidebar !== false
            ? "the switch changed"
            : !res.text.includes('"work":["dashboard","tickets","opportunities"]')
              ? "the effective layout is not the PSAsync default"
              : null)
    )
  } finally {
    await prisma.companySettings.updateMany({
      where: { companyId: ctx.b.companyId },
      data: {
        sidebarLayout: savedCompany?.sidebarLayout == null ? Prisma.DbNull : (savedCompany.sidebarLayout as Prisma.InputJsonValue),
        allowUserSidebar: savedCompany?.allowUserSidebar ?? true,
      },
    })
    if (savedEveryone) {
      await prisma.userPreferences.update({
        where: { userId: everyoneId },
        data: { sidebarLayout: savedEveryone.sidebarLayout == null ? Prisma.DbNull : (savedEveryone.sidebarLayout as Prisma.InputJsonValue) },
      })
    } else {
      await prisma.userPreferences.deleteMany({ where: { userId: everyoneId } })
    }
  }
}
