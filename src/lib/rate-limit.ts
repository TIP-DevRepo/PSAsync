import { createHash, randomUUID } from "node:crypto"
import { isIP } from "node:net"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// IP based rate limiting for the public, unauthenticated entry points
// (login, customer portal links, the SSO lookup, CSP reports), to slow
// down guessing from one network across many accounts or many links.
//
// - Failures only: a key counts failed attempts (a wrong password, an
//   unknown link). A key with no failure state counts every call. Success
//   never writes to the database.
// - Fixed windows: one counter row per key, hashed IP, and window, raised
//   by a single INSERT ... ON CONFLICT DO UPDATE statement.
// - The IP is never stored: rows hold sha256 of the key and the IP.
// - Fail open: any error (the table not migrated yet, a database error, a
//   timeout) lets the request through and logs one warning line without the
//   IP. A limiter problem must never block a user.
// - No usable IP (local development, where the address is loopback, and
//   the dev-only scripts) skips limiting entirely.
//
// Adding a key: add it to RATE_LIMITS, call recordFailure on its failure
// path, and either check isBlocked before the attempt or answer
// rateLimitedResponse when recordFailure reports blocked.

export interface RateLimitRule {
  // Attempts allowed per window; the next one is refused
  limit: number
  windowSeconds: number
}

export const RATE_LIMITS = {
  // Wrong passwords and unknown emails on the login page
  login: { limit: 20, windowSeconds: 15 * 60 },
  // Portal links that don't open (the shared "no longer valid" 404)
  portal: { limit: 30, windowSeconds: 15 * 60 },
  // Every call to the SSO lookup, which has no failure state
  "sso-lookup": { limit: 30, windowSeconds: 15 * 60 },
  // Every CSP violation report, generous since one page can send several
  "csp-report": { limit: 300, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitKey = keyof typeof RATE_LIMITS

// Rows older than this are deleted, at most once per CLEANUP_EVERY_MS per
// server instance, from the failure path
export const RATE_LIMIT_RETENTION_SECONDS = 2 * 24 * 60 * 60
const CLEANUP_EVERY_MS = 5 * 60 * 1000
// A slower database answer counts as an error, so the request goes through
const DB_TIMEOUT_MS = 2000
// At most one warning line per this long per instance
const WARN_EVERY_MS = 5 * 60 * 1000

export type LimitStatus = { blocked: false } | { blocked: true; retryAfterSeconds: number }
const NOT_BLOCKED: LimitStatus = { blocked: false }

type Headered = { headers: Headers }

// IPv4 or IPv6 loopback and unspecified addresses, which only show up when
// running locally
function isLocalAddress(ip: string): boolean {
  return ip === "::1" || ip === "::" || ip === "0.0.0.0" || /^127\./.test(ip) || /^::ffff:127\./.test(ip)
}

function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  let ip = raw.trim().toLowerCase()
  // [v6]:port and v4:port
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip)
  if (bracketed) ip = bracketed[1]
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"))
  if (!isIP(ip) || isLocalAddress(ip)) return null
  return ip
}

// The caller's IP. On Vercel the first x-forwarded-for entry is the client
// (Vercel sets the header itself), with x-real-ip as the fallback. Returns
// null when there is no usable address, which skips limiting.
export function getClientIp(request: Headered): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return normalizeIp(forwarded.split(",")[0])
  return normalizeIp(request.headers.get("x-real-ip"))
}

export function hashIp(key: RateLimitKey, ip: string): string {
  return createHash("sha256").update(`${key}:${ip}`).digest("hex")
}

// Start of the fixed window holding nowMs, in whole seconds since the epoch
export function windowStartSeconds(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds
}

export function retryAfterSeconds(nowMs: number, windowSeconds: number): number {
  const end = (windowStartSeconds(nowMs, windowSeconds) + windowSeconds) * 1000
  return Math.max(1, Math.ceil((end - nowMs) / 1000))
}

// Blocks this instance already knows about, so a blocked IP's further
// requests are refused without a database read. Keyed by hashed IP.
const knownBlocks = new Map<string, number>()

function rememberBlock(hashed: string, untilMs: number) {
  if (knownBlocks.size > 1000) {
    const now = Date.now()
    for (const [k, until] of knownBlocks) if (until <= now) knownBlocks.delete(k)
  }
  knownBlocks.set(hashed, untilMs)
}

function knownBlock(hashed: string, nowMs: number): LimitStatus {
  const until = knownBlocks.get(hashed)
  if (!until) return NOT_BLOCKED
  if (until <= nowMs) {
    knownBlocks.delete(hashed)
    return NOT_BLOCKED
  }
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((until - nowMs) / 1000)) }
}

let lastWarning = 0
function warnFailOpen(action: string, err: unknown) {
  const now = Date.now()
  if (now - lastWarning < WARN_EVERY_MS) return
  lastWarning = now
  // Only the error's kind, never the IP, the query, or its values
  const kind = err instanceof Error ? (err as { code?: unknown }).code ?? err.name : typeof err
  console.warn(`Rate limiter unavailable (${action}, ${String(kind)}); request allowed`)
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("RateLimitTimeout")), DB_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

let lastCleanup = 0
function cleanupIfDue(nowMs: number) {
  if (nowMs - lastCleanup < CLEANUP_EVERY_MS) return
  lastCleanup = nowMs
  const cutoff = Math.floor(nowMs / 1000) - RATE_LIMIT_RETENTION_SECONDS
  // windowStart is stored the way Prisma stores dates: UTC, without a zone
  withTimeout(prisma.$executeRaw`
    DELETE FROM "rate_limits" WHERE "windowStart" < (to_timestamp(${cutoff}) AT TIME ZONE 'UTC')
  `).catch((err) => warnFailOpen("cleanup", err))
}

// Counts one failure (or one call) for this IP and key. Reports blocked
// once the count passes the key's limit, for routes that answer 429 on
// the attempt itself. Never throws.
export async function recordFailure(key: RateLimitKey, ip: string | null): Promise<LimitStatus> {
  if (!ip) return NOT_BLOCKED
  const rule: RateLimitRule = RATE_LIMITS[key]
  const nowMs = Date.now()
  try {
    const hashed = hashIp(key, ip)
    const start = windowStartSeconds(nowMs, rule.windowSeconds)
    const rows = await withTimeout(prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "rate_limits" ("id", "key", "hashedIp", "windowStart", "count", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${key}, ${hashed}, (to_timestamp(${start}) AT TIME ZONE 'UTC'), 1, NOW(), NOW())
      ON CONFLICT ("key", "hashedIp", "windowStart")
      DO UPDATE SET "count" = "rate_limits"."count" + 1, "updatedAt" = NOW()
      RETURNING "count"
    `)
    cleanupIfDue(nowMs)
    const count = Number(rows[0]?.count ?? 0)
    if (count > rule.limit) {
      rememberBlock(hashed, (start + rule.windowSeconds) * 1000)
      return { blocked: true, retryAfterSeconds: retryAfterSeconds(nowMs, rule.windowSeconds) }
    }
    return NOT_BLOCKED
  } catch (err) {
    warnFailOpen(`record ${key}`, err)
    return NOT_BLOCKED
  }
}

// Whether this IP has already used up the key's limit in the current
// window, checked before an attempt. Reads only, never writes. Never throws.
export async function isBlocked(key: RateLimitKey, ip: string | null): Promise<LimitStatus> {
  if (!ip) return NOT_BLOCKED
  const rule: RateLimitRule = RATE_LIMITS[key]
  const nowMs = Date.now()
  try {
    const hashed = hashIp(key, ip)
    const known = knownBlock(hashed, nowMs)
    if (known.blocked) return known
    const start = windowStartSeconds(nowMs, rule.windowSeconds)
    const rows = await withTimeout(prisma.$queryRaw<{ count: number }[]>`
      SELECT "count" FROM "rate_limits"
      WHERE "key" = ${key} AND "hashedIp" = ${hashed} AND "windowStart" = (to_timestamp(${start}) AT TIME ZONE 'UTC')
    `)
    const count = Number(rows[0]?.count ?? 0)
    if (count >= rule.limit) {
      rememberBlock(hashed, (start + rule.windowSeconds) * 1000)
      return { blocked: true, retryAfterSeconds: retryAfterSeconds(nowMs, rule.windowSeconds) }
    }
    return NOT_BLOCKED
  } catch (err) {
    warnFailOpen(`check ${key}`, err)
    return NOT_BLOCKED
  }
}

// Blocks this instance already recorded, without touching the database.
// For routes where a normal request must not cost a query (portal links).
export function isKnownBlocked(key: RateLimitKey, ip: string | null): LimitStatus {
  if (!ip) return NOT_BLOCKED
  try {
    return knownBlock(hashIp(key, ip), Date.now())
  } catch {
    return NOT_BLOCKED
  }
}

// ─── Per subject limits ─────────────────────────────────────────────────
// Some public work is expensive even for a request that is allowed: each
// portal PDF starts a headless browser and each portal comment emails the
// rep. Those count EVERY request per customer link, whatever the network,
// in the same table and fixed windows as the IP limits. The subject (the
// link's token) is hashed with the key like an IP, never stored as is.

export const SUBJECT_LIMITS = {
  // Portal PDF downloads per customer link
  "portal-pdf": { limit: 20, windowSeconds: 60 * 60 },
  // Portal comments posted per customer link
  "portal-comment": { limit: 30, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>

export type SubjectLimitKey = keyof typeof SUBJECT_LIMITS

export function hashSubject(key: string, subject: string): string {
  return createHash("sha256").update(`${key}:${subject}`).digest("hex")
}

// Counts one request for this key and subject and reports blocked once the
// count passes limit within the window. One upsert per request (none for a
// subject this instance already knows is blocked). Fails open like every
// other limit: any error lets the request through. Never throws.
export async function consume(key: string, subject: string, limit: number, windowMs: number): Promise<LimitStatus> {
  if (!subject) return NOT_BLOCKED
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000))
  const nowMs = Date.now()
  try {
    const hashed = hashSubject(key, subject)
    const known = knownBlock(hashed, nowMs)
    if (known.blocked) return known
    const start = windowStartSeconds(nowMs, windowSeconds)
    const rows = await withTimeout(prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "rate_limits" ("id", "key", "hashedIp", "windowStart", "count", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${key}, ${hashed}, (to_timestamp(${start}) AT TIME ZONE 'UTC'), 1, NOW(), NOW())
      ON CONFLICT ("key", "hashedIp", "windowStart")
      DO UPDATE SET "count" = "rate_limits"."count" + 1, "updatedAt" = NOW()
      RETURNING "count"
    `)
    cleanupIfDue(nowMs)
    const count = Number(rows[0]?.count ?? 0)
    if (count > limit) {
      rememberBlock(hashed, (start + windowSeconds) * 1000)
      return { blocked: true, retryAfterSeconds: retryAfterSeconds(nowMs, windowSeconds) }
    }
    return NOT_BLOCKED
  } catch (err) {
    warnFailOpen(`consume ${key}`, err)
    return NOT_BLOCKED
  }
}

// consume with a SUBJECT_LIMITS rule
export function consumeSubject(key: SubjectLimitKey, subject: string): Promise<LimitStatus> {
  const rule = SUBJECT_LIMITS[key]
  return consume(key, subject, rule.limit, rule.windowSeconds * 1000)
}

// The 429 for a customer link that has been used too often, worded for the
// customer (it is the link, not their network)
export function linkLimitedResponse(retryAfter: number) {
  const minutes = minutesUntil(retryAfter)
  return NextResponse.json(
    {
      error: `This quote link has been used too often. Please try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      code: RATE_LIMITED_CODE,
      retryAfterSeconds: retryAfter,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  )
}

export function minutesUntil(retryAfter: number): number {
  return Math.max(1, Math.ceil(retryAfter / 60))
}

export const RATE_LIMITED_CODE = "RATE_LIMITED"

export function rateLimitedMessage(retryAfter: number): string {
  const minutes = minutesUntil(retryAfter)
  return `Too many attempts from your network. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
}

// The 429 every limited route answers: a plain message, the code, and a
// Retry-After header in seconds
export function rateLimitedResponse(retryAfter: number) {
  return NextResponse.json(
    { error: rateLimitedMessage(retryAfter), code: RATE_LIMITED_CODE, retryAfterSeconds: retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  )
}
