// Security header check: fetches a few routes from a running app and
// verifies every enforced header (src/lib/security-headers.ts) is present
// with the expected value, and that the Content-Security-Policy for
// CSP_MODE is present and parses. Needs no database and no secrets: every
// request is one that answers without signing in or touching the database
// (a malformed portal token is refused before any lookup).
//
//   npm run check:headers
//   npm run check:headers -- --base-url https://your-preview.vercel.app
//
// Exit codes: 0 every check passes, 1 a check fails, 2 the app couldn't be
// reached.

import { CSP_MODE, CSP_REPORT_PATH } from "../src/lib/security-headers"

const ENFORCED: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
}

function readBaseUrl(argv: readonly string[]): string {
  let value = "http://localhost:3000"
  argv.forEach((arg, i) => {
    if (arg === "--base-url" && argv[i + 1]) value = argv[i + 1]
    else if (arg.startsWith("--base-url=")) value = arg.slice("--base-url=".length)
  })
  return new URL(value).origin
}

// Directive names to their sources, or an error when the header doesn't
// parse as a policy
function parseCsp(value: string): Map<string, string[]> | string {
  const directives = new Map<string, string[]>()
  for (const part of value.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const [name, ...sources] = tokens
    if (!/^[a-z-]+$/.test(name)) return `bad directive name "${name}"`
    if (directives.has(name)) return `directive ${name} appears twice`
    directives.set(name, sources)
  }
  return directives.size > 0 ? directives : "empty policy"
}

function checkFullPolicy(value: string | null): string[] {
  if (!value) return ["missing"]
  const parsed = parseCsp(value)
  if (typeof parsed === "string") return [parsed]
  const problems: string[] = []
  const expect = (name: string, source: string) => {
    if (!parsed.get(name)?.includes(source)) problems.push(`${name} should include ${source}`)
  }
  expect("default-src", "'self'")
  expect("object-src", "'none'")
  expect("base-uri", "'self'")
  expect("form-action", "'self'")
  expect("frame-ancestors", "'none'")
  expect("report-uri", CSP_REPORT_PATH)
  if (!parsed.has("report-to")) problems.push("report-to is missing")
  return problems
}

interface Target {
  label: string
  path: string
  method: "GET" | "POST"
  body?: string
  contentType?: string
  status: (code: number) => boolean
  statusText: string
}

const SAMPLE_REPORT = JSON.stringify({
  "csp-report": {
    "document-uri": "http://localhost/check-headers",
    "violated-directive": "img-src",
    "effective-directive": "img-src",
    "blocked-uri": "https://example.invalid/pixel.png",
  },
})

const TARGETS: Target[] = [
  { label: "login page", path: "/login", method: "GET", status: (c) => c === 200, statusText: "200" },
  { label: "dashboard (signed out)", path: "/dashboard", method: "GET", status: (c) => c >= 300 && c < 400, statusText: "a redirect" },
  { label: "API route (signed out)", path: "/api/users", method: "GET", status: (c) => c === 401, statusText: "401" },
  { label: "portal page", path: "/portal/check-headers", method: "GET", status: (c) => c === 200, statusText: "200" },
  { label: "portal API (malformed token)", path: "/api/portal/x", method: "GET", status: (c) => c === 404, statusText: "404" },
  {
    label: "CSP report",
    path: CSP_REPORT_PATH,
    method: "POST",
    body: SAMPLE_REPORT,
    contentType: "application/csp-report",
    status: (c) => c === 204,
    statusText: "204",
  },
]

async function main() {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  console.log(`check-headers: ${baseUrl}, CSP mode ${CSP_MODE}\n`)
  let failures = 0

  for (const target of TARGETS) {
    let res: Response
    try {
      res = await fetch(`${baseUrl}${target.path}`, {
        method: target.method,
        redirect: "manual",
        headers: target.contentType ? { "Content-Type": target.contentType } : undefined,
        body: target.body,
      })
    } catch (err) {
      console.error(`Couldn't reach ${baseUrl}${target.path}: ${err instanceof Error ? err.message : String(err)}`)
      console.error("Start the app first (npm run dev or npm run start), or pass --base-url.")
      process.exit(2)
    }

    const problems: string[] = []
    if (!target.status(res.status)) problems.push(`status ${res.status}, expected ${target.statusText}`)
    for (const [name, expected] of Object.entries(ENFORCED)) {
      const actual = res.headers.get(name)
      if (actual !== expected) problems.push(`${name}: ${actual === null ? "missing" : `"${actual}"`}, expected "${expected}"`)
    }

    const enforcedCsp = res.headers.get("content-security-policy")
    const reportOnly = res.headers.get("content-security-policy-report-only")
    if (CSP_MODE === "report-only") {
      for (const p of checkFullPolicy(reportOnly)) problems.push(`Content-Security-Policy-Report-Only: ${p}`)
      const parsed = enforcedCsp ? parseCsp(enforcedCsp) : null
      if (!parsed || typeof parsed === "string" || !parsed.get("frame-ancestors")?.includes("'none'")) {
        problems.push("Content-Security-Policy should enforce frame-ancestors 'none'")
      }
    } else {
      for (const p of checkFullPolicy(enforcedCsp)) problems.push(`Content-Security-Policy: ${p}`)
    }
    if (!res.headers.get("reporting-endpoints")?.includes(CSP_REPORT_PATH)) problems.push("Reporting-Endpoints is missing")

    const result = problems.length === 0 ? "PASS" : "FAIL"
    console.log(`${result}  ${target.method} ${target.path} (${target.label}) -> ${res.status}`)
    for (const p of problems) console.log(`        ${p}`)
    if (problems.length > 0) failures++
  }

  console.log(failures === 0 ? "\nAll header checks passed." : `\n${failures} route(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
