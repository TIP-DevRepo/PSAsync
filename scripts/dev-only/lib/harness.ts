// HTTP harness for the dev-only check scripts: signs in through the real
// Auth.js credentials flow against a server on this machine and keeps the
// session cookie in memory only. Same behavior as the harness inside
// check-cross-company.ts, which keeps its own copy for now.
//
// No database imports here, so loading this file never touches the database.

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type Result = "PASS" | "FAIL" | "UNEXPECTED"

export interface Row {
  attempt: string
  expected: string
  actual: string
  result: Result
  note?: string
}

// Thrown when the harness itself can't be trusted (bad setup, failed sign
// in, failed positive control). Scripts exit with code 2 for it.
export class HarnessBroken extends Error {}

export function readBaseUrl(argv: readonly string[]): string {
  let value = "http://localhost:3000"
  argv.forEach((arg, i) => {
    if (arg === "--base-url" && argv[i + 1]) value = argv[i + 1]
    else if (arg.startsWith("--base-url=")) value = arg.slice("--base-url=".length)
  })
  const url = new URL(value)
  // Only ever a server on this machine, which `next dev` points at the dev database
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new HarnessBroken(`--base-url must point at this machine (localhost), got ${url.hostname}`)
  }
  return url.origin
}

// Cookies live only in this object, never on disk
export class Session {
  private cookies = new Map<string, string>()
  constructor(
    readonly label: string,
    private readonly baseUrl: string
  ) {}

  private store(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";")
      const eq = pair.indexOf("=")
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))
      if (!value || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  hasSessionCookie() {
    return [...this.cookies.keys()].some((k) => k.includes("authjs.session-token"))
  }

  async request(method: Method, path: string, options: { json?: unknown; form?: URLSearchParams } = {}) {
    const headers: Record<string, string> = { Cookie: this.cookieHeader() }
    let body: BodyInit | undefined
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded"
      body = options.form
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(options.json)
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body, redirect: "manual" })
    this.store(res)
    const text = await res.text()
    return { status: res.status, text, location: res.headers.get("location") ?? "" }
  }

  // The real Auth.js credentials flow: csrf token, then the callback
  async signIn(email: string, password: string) {
    const csrf = await this.request("GET", "/api/auth/csrf")
    const csrfToken = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken
    if (!csrfToken) throw new HarnessBroken(`${this.label}: no csrf token from /api/auth/csrf`)

    const form = new URLSearchParams({ csrfToken, email, password, callbackUrl: `${this.baseUrl}/dashboard` })
    const callback = await this.request("POST", "/api/auth/callback/credentials", { form })
    const error = new URL(callback.location || "/", this.baseUrl).searchParams.get("error")
    if (error || !this.hasSessionCookie()) {
      throw new HarnessBroken(`${this.label}: sign in failed (${error ?? "no session cookie"}). Check the password variable and that the account isn't locked.`)
    }

    const session = await this.request("GET", "/api/auth/session")
    const user = (JSON.parse(session.text || "null") as { user?: { email?: string } } | null)?.user
    if (user?.email !== email) throw new HarnessBroken(`${this.label}: signed in, but /api/auth/session doesn't show ${email}`)
  }
}

// Every refusal from the app is a JSON { error }. Next's own 404 for a path
// that doesn't exist is an HTML page, which must never count as a refusal.
export function isJsonError(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    return !!parsed && typeof parsed.error === "string"
  } catch {
    return false
  }
}

export function errorText(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (parsed && typeof parsed.error === "string") return parsed.error
  } catch {
    // not JSON
  }
  return text.slice(0, 120)
}

// What a check returns: its exit code (0 all passed, 1 a FAIL or
// UNEXPECTED) and the counts its summary line printed, for run-checks.ts
export interface CheckResult {
  code: 0 | 1
  total: number
  pass: number
  fail: number
  unexpected: number
}

export function checkResult(rows: { result: string }[]): CheckResult {
  const count = (r: Result) => rows.filter((row) => row.result === r).length
  const [pass, fail, unexpected] = [count("PASS"), count("FAIL"), count("UNEXPECTED")]
  return { code: fail + unexpected > 0 ? 1 : 0, total: rows.length, pass, fail, unexpected }
}

export function printTable(rows: Row[]) {
  const headers = ["Attempt", "Expected", "Actual", "Result"]
  const cells = rows.map((r) => [r.attempt, r.expected, r.actual, r.result])
  // Columns sized to their longest value, nothing is cut short
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ")
  console.log("")
  console.log(line(headers))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const c of cells) console.log(line(c))
  const notes = rows.filter((r) => r.note && r.result !== "PASS")
  if (notes.length > 0) {
    console.log("\nDetails:")
    for (const r of notes) console.log(`  ${r.result} ${r.attempt}: ${r.note}`)
  }
}
