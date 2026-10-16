// Route coverage check: every API route handler must start with
// requireAccess (src/lib/api-access.ts) unless its route is on the public
// list below. Reads files only, needs no database and no network.
//
//   npm run check:routes
//
// Exit codes: 0 every handler passes, 1 a handler fails the check.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// Routes that are reachable without signing in, relative to src/app/api.
// Each one checks its caller some other way (NextAuth itself, a portal
// token, or the Microsoft sign in flow). Adding a route here makes it
// public, so only add one that must be.
const PUBLIC_ROUTES = [
  "auth/[...nextauth]",
  "portal/[token]",
  "portal/[token]/accept",
  "portal/[token]/comments",
  "portal/[token]/decline",
  "portal/[token]/line-items/[lineItemId]",
  "portal/[token]/pdf",
  "sso/callback",
  "sso/lookup",
  "sso/start",
]

const API_ROOT = join(process.cwd(), "src", "app", "api")
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

function findRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) found.push(...findRouteFiles(full))
    else if (name === "route.ts") found.push(full)
  }
  return found
}

// The route's folder relative to src/app/api, with forward slashes
function routeKey(file: string): string {
  return relative(API_ROOT, file).split(sep).slice(0, -1).join("/")
}

// The index just past the bracket that closes the one at start, skipping
// over strings and comments so a brace inside them doesn't count
function matchClose(src: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i)
      if (i === -1) return -1
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1
      if (i === 0) return -1
      continue
    }
    if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++
      continue
    }
    if (c === "`") {
      // A template literal, whose ${...} parts can hold any code
      for (i++; i < src.length && src[i] !== "`"; i++) {
        if (src[i] === "\\") i++
        else if (src[i] === "$" && src[i + 1] === "{") {
          const end = matchClose(src, i + 1, "{", "}")
          if (end === -1) return -1
          i = end - 1
        }
      }
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

interface Handler {
  method: string
  body: string | null
}

// Every exported HTTP method handler in a route file. body is null for an
// export the script can't read as a function body (export const GET = ...).
function findHandlers(src: string): Handler[] {
  const handlers: Handler[] = []

  const fnExport = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODS.join("|")})\\s*\\(`, "g")
  for (const m of src.matchAll(fnExport)) {
    const paramsStart = (m.index ?? 0) + m[0].length - 1
    const paramsEnd = matchClose(src, paramsStart, "(", ")")
    const bodyStart = paramsEnd === -1 ? -1 : src.indexOf("{", paramsEnd)
    const bodyEnd = bodyStart === -1 ? -1 : matchClose(src, bodyStart, "{", "}")
    handlers.push({ method: m[1], body: bodyEnd === -1 ? null : src.slice(bodyStart, bodyEnd) })
  }

  const otherExport = new RegExp(`export\\s+(?:const|let|var)\\s+(?:\\{([^}]*)\\}|(${METHODS.join("|")})\\b)`, "g")
  for (const m of src.matchAll(otherExport)) {
    const names = m[1] ? m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop() ?? "") : [m[2]]
    for (const name of names) if (METHODS.includes(name)) handlers.push({ method: name, body: null })
  }

  return handlers
}

// The handler's first statement must be the requireAccess call, so no
// query or body read happens before access is checked. The response may be
// renamed (response: refusal) for routes that turn a refusal into a redirect.
const REQUIRE_ACCESS_FIRST =
  /^const\s*\{\s*(?:ctx\s*,\s*)?response(?:\s*:\s*\w+)?\s*\}\s*=\s*await\s+requireAccess\s*\(/

function startsWithRequireAccess(body: string): boolean {
  const inner = body.slice(1).replace(/^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/, "")
  return REQUIRE_ACCESS_FIRST.test(inner)
}

function main() {
  if (!existsSync(API_ROOT)) {
    console.error(`No API folder at ${API_ROOT}. Run this from the repo root.`)
    process.exit(1)
  }

  const files = findRouteFiles(API_ROOT).sort()
  const keys = new Set(files.map(routeKey))
  const failures: string[] = []
  let checked = 0
  let publicCount = 0

  for (const file of files) {
    const key = routeKey(file)
    const src = readFileSync(file, "utf8")
    const handlers = findHandlers(src)

    if (PUBLIC_ROUTES.includes(key)) {
      publicCount += handlers.length
      continue
    }

    if (handlers.length === 0) {
      failures.push(`${key}: no exported handler found, check the file by hand`)
      continue
    }

    for (const h of handlers) {
      checked++
      if (h.body === null) {
        failures.push(`${key} ${h.method}: not a function the script can read, so it can't confirm requireAccess`)
      } else if (!startsWithRequireAccess(h.body)) {
        failures.push(`${key} ${h.method}: does not start with const { ctx, response } = await requireAccess(...)`)
      }
    }
  }

  for (const key of PUBLIC_ROUTES) {
    if (!keys.has(key)) console.warn(`Note: public route ${key} no longer exists, remove it from PUBLIC_ROUTES`)
  }

  if (failures.length > 0) {
    console.error(`Route access check failed for ${failures.length} handler(s):`)
    for (const f of failures) console.error(`  ${f}`)
    console.error("Start each handler with requireAccess, or add a route that must be public to PUBLIC_ROUTES.")
    process.exit(1)
  }

  console.log(
    `Route access check passed: ${checked} handler(s) in ${files.length} route file(s) use requireAccess, ` +
      `${publicCount} public handler(s) skipped.`
  )
}

main()
