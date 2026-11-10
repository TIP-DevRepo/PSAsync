import { test } from "node:test"
import assert from "node:assert/strict"
import { checkPrefixedTitle, fitPrefixedTitle, prefixedTitle, TITLE_PREFIX_SEPARATOR } from "./record-title"

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

// The length limit counts the saved title, prefix included

test("a title that fits alone but not once prefixed is refused", () => {
  const typed = "x".repeat(195)
  assert.equal(typed.length <= 200, true)
  const result = checkPrefixedTitle(typed, "ACME", 200)
  assert.equal(result.value, undefined)
  assert.equal(result.error, "With the client prefix the title would be 202 characters, and titles can be up to 200. Shorten it by 2 characters.")
})

test("the same title is fine without a prefix, or when it fits exactly", () => {
  const typed = "x".repeat(195)
  assert.equal(checkPrefixedTitle(typed, null, 200).value, typed)
  assert.equal(checkPrefixedTitle("x".repeat(193), "ACME", 200).value, `ACME - ${"x".repeat(193)}`)
  assert.equal(checkPrefixedTitle("x".repeat(193), "ACME", 200).value?.length, 200)
  assert.match(checkPrefixedTitle("x".repeat(194), "ACME", 200).error ?? "", /Shorten it by 1 character\.$/)
})

test("an already prefixed title is measured as typed", () => {
  const typed = `ACME - ${"x".repeat(193)}`
  assert.equal(checkPrefixedTitle(typed, "ACME", 200).value, typed)
})

test("a title nobody typed is cut to fit instead", () => {
  const fitted = fitPrefixedTitle("y".repeat(199), "ACME", 200)
  assert.equal(fitted.length, 200)
  assert.equal(fitted.startsWith("ACME - "), true)
  assert.equal(fitPrefixedTitle("Short", "ACME", 200), "ACME - Short")
})
