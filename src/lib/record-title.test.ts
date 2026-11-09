import { test } from "node:test"
import assert from "node:assert/strict"
import { prefixedTitle, TITLE_PREFIX_SEPARATOR } from "./record-title"

// The client prefix rule for new ticket and opportunity titles
// (src/lib/record-title.ts). Run with npm test.

test("a client with a prefix: <PREFIX> - <title>", () => {
  assert.equal(prefixedTitle("Login Help", "ACME"), "ACME - Login Help")
  assert.equal(TITLE_PREFIX_SEPARATOR, " - ")
})

test("a client without a prefix: the title as typed", () => {
  assert.equal(prefixedTitle("Login Help", null), "Login Help")
  assert.equal(prefixedTitle("Login Help", undefined), "Login Help")
  assert.equal(prefixedTitle("Login Help", ""), "Login Help")
  assert.equal(prefixedTitle("Login Help", "   "), "Login Help")
})

test("already prefixed: not added twice", () => {
  assert.equal(prefixedTitle("ACME - Login Help", "ACME"), "ACME - Login Help")
})

test("already prefixed in another case: kept as typed", () => {
  assert.equal(prefixedTitle("acme - Login Help", "ACME"), "acme - Login Help")
  assert.equal(prefixedTitle("Acme - login help", "ACME"), "Acme - login help")
  assert.equal(prefixedTitle("ACME - Login Help", "acme"), "ACME - Login Help")
})

test("mixed case titles and prefixes keep their own case", () => {
  assert.equal(prefixedTitle("login HELP", "AcMe"), "AcMe - login HELP")
})

test("whitespace: the title and prefix are trimmed", () => {
  assert.equal(prefixedTitle("  Login Help  ", " ACME "), "ACME - Login Help")
  assert.equal(prefixedTitle("   ACME - Login Help ", "ACME"), "ACME - Login Help")
  assert.equal(prefixedTitle("  Login Help ", null), "Login Help")
})

test("only the exact prefix and separator count as already prefixed", () => {
  // The prefix without the separator, or as part of a word, still gets it
  assert.equal(prefixedTitle("ACME Login Help", "ACME"), "ACME - ACME Login Help")
  assert.equal(prefixedTitle("ACMECORP - Login", "ACME"), "ACME - ACMECORP - Login")
  assert.equal(prefixedTitle("ACME-Login", "ACME"), "ACME - ACME-Login")
})
