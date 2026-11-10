import { test } from "node:test"
import assert from "node:assert/strict"
import { EMPTY_FILTERS, opportunityFolderHref, opportunityUrlQuery, readOpportunityUrl } from "./opportunity-view"
import { EMPTY_TICKET_QUERY, readTicketPageUrl, ticketFolderHref, ticketPageQuery } from "./ticket-list"

// The sidebar layout's default views (src/lib/sidebar-layout.ts) apply only
// when the page's URL doesn't already choose a view. Run with npm test.

const params = (query: string) => new URLSearchParams(query)

test("opportunities: no view in the URL opens the default view", () => {
  assert.equal(readOpportunityUrl(params("")).view, "board")
  assert.equal(readOpportunityUrl(params(""), "list").view, "list")
  assert.equal(readOpportunityUrl(params("team=abc"), "list").view, "list")
})

test("opportunities: a view in the URL wins over the default", () => {
  assert.equal(readOpportunityUrl(params("view=board"), "list").view, "board")
  assert.equal(readOpportunityUrl(params("view=list"), "board").view, "list")
  // An unknown view falls back to the default
  assert.equal(readOpportunityUrl(params("view=calendar"), "list").view, "list")
})

test("opportunities: switching views writes the view unless it is the default", () => {
  assert.equal(opportunityUrlQuery("board", EMPTY_FILTERS), "")
  assert.equal(opportunityUrlQuery("list", EMPTY_FILTERS), "?view=list")
  assert.equal(opportunityUrlQuery("board", EMPTY_FILTERS, "list"), "?view=board")
  assert.equal(opportunityUrlQuery("list", EMPTY_FILTERS, "list"), "")
  // The sidebar folder's links choose no view, so the default applies
  assert.equal(opportunityFolderHref("t1"), "/dashboard/opportunities?team=t1")
})

test("tickets: no view in the URL opens the default view", () => {
  assert.equal(readTicketPageUrl(params("")).view, "open")
  assert.equal(readTicketPageUrl(params(""), "mine").view, "mine")
  assert.equal(readTicketPageUrl(params("view=waiting"), "mine").view, "waiting")
  assert.equal(readTicketPageUrl(params("view=nonsense"), "all").view, "all")
})

test("tickets: switching views writes the view unless it is the default", () => {
  assert.equal(ticketPageQuery({ ...EMPTY_TICKET_QUERY, view: "open" }, "mine"), "?view=open")
  assert.equal(ticketPageQuery({ ...EMPTY_TICKET_QUERY, view: "mine" }, "mine"), "")
  assert.equal(ticketPageQuery({ ...EMPTY_TICKET_QUERY, view: "open" }), "")
  assert.equal(ticketFolderHref("q1"), "/dashboard/tickets?team=q1")
})
