import { test } from "node:test"
import assert from "node:assert/strict"
import { CLIENT_OPPORTUNITY_FILTERS, clientOpportunityCategory, isClientOpportunityFilter, opportunityHref } from "./opportunity-view"

// The client page's Opportunities tab filter (GET
// /api/clients/[id]/opportunities?status=). Run with npm test.

test("each filter keeps one stage category, All keeps every one", () => {
  assert.equal(clientOpportunityCategory("open"), "OPEN")
  assert.equal(clientOpportunityCategory("won"), "WON")
  assert.equal(clientOpportunityCategory("lost"), "LOST")
  assert.equal(clientOpportunityCategory("all"), null)
  assert.equal(CLIENT_OPPORTUNITY_FILTERS[0], "open")
})

test("only the known filters are accepted", () => {
  for (const f of CLIENT_OPPORTUNITY_FILTERS) assert.equal(isClientOpportunityFilter(f), true)
  assert.equal(isClientOpportunityFilter("OPEN"), false)
  assert.equal(isClientOpportunityFilter("closed"), false)
  assert.equal(isClientOpportunityFilter(null), false)
})

test("a row opens its opportunity", () => {
  assert.equal(opportunityHref("abc"), "/dashboard/opportunities/abc")
})
