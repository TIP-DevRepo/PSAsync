// Reading CSP violation reports for POST /api/csp-report. Kept free of
// database and network imports so it can be tested on its own. Only three
// facts ever leave a report: the directive, the blocked origin (no path or
// query), and the page path (no query, portal tokens hidden).

export const CSP_REPORT_MAX_BYTES = 10 * 1024

const REPORT_TYPES = new Set(["application/csp-report", "application/reports+json", "application/json"])

export function isReportContentType(header: string | null): boolean {
  if (!header) return false
  return REPORT_TYPES.has(header.split(";")[0].trim().toLowerCase())
}

// The body as text, or null when it is larger than max bytes (checked on
// the declared length and while reading, so a huge body is never held)
export async function readLimitedText(req: Request, max = CSP_REPORT_MAX_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return ""
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

export interface CspViolation {
  directive: string
  blocked: string
  page: string
}

const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "self", "data", "blob", "trusted-types-policy", "trusted-types-sink"])

function cleanDirective(value: unknown): string {
  if (typeof value !== "string") return "unknown"
  // Older reports put the whole directive, sources included, in this field
  const name = value.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  return /^[a-z-]{1,40}$/.test(name) ? name : "unknown"
}

function cleanBlocked(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "none"
  const raw = value.trim()
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase()
  if (scheme === "data" || scheme === "blob") return scheme
  if (KEYWORDS.has(raw.toLowerCase())) return raw.toLowerCase()
  try {
    const url = new URL(raw)
    if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return url.origin
    return url.protocol.replace(":", "")
  } catch {
    return "other"
  }
}

function cleanPage(value: unknown): string {
  if (typeof value !== "string") return "unknown"
  try {
    let path = new URL(value).pathname
    // A customer's portal token is a secret link, never logged
    path = path.replace(/^\/portal\/[^/]+/, "/portal/[token]")
    path = path.replace(/[^\x21-\x7e]/g, "")
    return path.length > 200 ? `${path.slice(0, 200)}...` : path || "/"
  } catch {
    return "unknown"
  }
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

// Every violation in a report body, in either format:
// - application/csp-report (report-uri): { "csp-report": { ... } }
// - application/reports+json (report-to): [{ type: "csp-violation", body: { ... } }]
export function readViolations(parsed: unknown): CspViolation[] {
  const found: CspViolation[] = []
  if (isObject(parsed) && isObject(parsed["csp-report"])) {
    const r = parsed["csp-report"]
    found.push({
      directive: cleanDirective(r["effective-directive"] ?? r["violated-directive"]),
      blocked: cleanBlocked(r["blocked-uri"]),
      page: cleanPage(r["document-uri"]),
    })
  } else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!isObject(item) || item.type !== "csp-violation" || !isObject(item.body)) continue
      const b = item.body
      found.push({
        directive: cleanDirective(b.effectiveDirective ?? b.violatedDirective),
        blocked: cleanBlocked(b.blockedURL),
        page: cleanPage(b.documentURL ?? item.url),
      })
    }
  }
  return found
}

// The one log line for a report body
export function violationLogLine(violations: CspViolation[]): string | null {
  const [first] = violations
  if (!first) return null
  const more = violations.length > 1 ? ` (+${violations.length - 1} more)` : ""
  return `CSP violation: directive=${first.directive} blocked=${first.blocked} page=${first.page}${more}`
}
