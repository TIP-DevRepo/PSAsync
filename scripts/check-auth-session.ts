// Auth.js behavior check: runs the real src/auth.ts and the installed
// next-auth, with only the database replaced by an in-memory fake, and
// checks the behavior our sign in protection depends on. Run it after every
// next-auth, @auth/core, or next upgrade; an upgrade must keep it passing.
// Needs no database and no network (both are blocked before anything loads).
//
//   npm run check:auth
//
// What it guards:
// - A deactivated or deleted user: the session callback in src/auth.ts
//   returns user: null, and auth() must return a session whose user is null.
//   next-auth's server side wrapper builds the session as
//   { user: user ?? token, ...session }, so simply deleting user would hand
//   back the raw JWT as the user; this checks both halves of that.
// - The absolute session cap: the jwt callback returning null must end the
//   session, so auth() returns null and the cookie is cleared.
// - A configuration error must make auth() return null, not an error object.
// - Cookie names and attributes, the credentials flow, the lockout code in
//   the sign in redirect, and requireAccess answering 401.
//
// Exit codes: 0 every check passes, 1 a check fails, 2 the harness broke.

import Module, { createRequire } from "node:module"
import { AsyncLocalStorage } from "node:async_hooks"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import net from "node:net"
import tls from "node:tls"
import http from "node:http"
import https from "node:https"
import dns from "node:dns"

const ROOT = process.cwd()
const AUTH_FILE = join(ROOT, "src", "auth.ts")
if (!existsSync(AUTH_FILE)) {
  console.error(`No src/auth.ts under ${ROOT}. Run this from the repo root.`)
  process.exit(2)
}

// ── No network: any real connection fails the run ──
function blocked(what: string) {
  return () => {
    throw new Error(`check-auth-session blocked a network call (${what})`)
  }
}
net.Socket.prototype.connect = blocked("socket") as never
net.connect = net.createConnection = blocked("net.connect") as never
tls.connect = blocked("tls.connect") as never
http.request = http.get = blocked("http.request") as never
https.request = https.get = blocked("https.request") as never
dns.lookup = blocked("dns.lookup") as never
globalThis.fetch = blocked("fetch") as never

// Throwaway values, so the run never depends on the shell's settings. No
// env file is loaded: tsx doesn't, and nothing here reads one.
const SECRET = "check-auth-session-throwaway-secret"
Object.assign(process.env, {
  AUTH_SECRET: SECRET,
  AUTH_TRUST_HOST: "true",
  NODE_ENV: "test",
  DB_HOST: "check-auth.invalid",
  DB_NAME: "check_auth_never_connects",
})
delete process.env.AUTH_URL
delete process.env.NEXTAUTH_URL
delete process.env.NEXTAUTH_SECRET

// ── In-memory database ──
interface FakeUser {
  id: string
  companyId: string
  name: string
  email: string
  password: string
  active: boolean
  loginFailedAttempts: number
  loginLockedUntil: Date | null
}
const users: FakeUser[] = []

// One user delegate serves both clients: the one src/auth.ts builds itself
// and the shared one getEffectiveAccess reads through @/lib/prisma
const userDelegate = {
  async findUnique({ where }: { where: { id?: string; email?: string } }) {
    const u = users.find((x) => (where.email !== undefined ? x.email === where.email : x.id === where.id))
    if (!u) return null
    return { ...u, mustChangePassword: false, company: { settings: { ssoEnabled: false } }, userRoles: [], teamMemberships: [] }
  },
  async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
    const u = users.find((x) => x.id === where.id)
    if (!u) throw new Error("No such user")
    for (const [key, value] of Object.entries(data)) {
      const record = u as unknown as Record<string, unknown>
      const step = (value as { increment?: number } | null)?.increment
      record[key] = typeof step === "number" ? Number(record[key]) + step : value
    }
    return u
  },
  async updateMany() {
    return { count: 0 }
  },
}
const fakePrisma = { user: userDelegate, role: { findFirst: async () => null } }
class FakePrismaClient {
  user = userDelegate
  role = fakePrisma.role
}

type Loader = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown
const moduleInternals = Module as unknown as { _load: Loader }
const originalLoad = moduleInternals._load
const slashes = (s: string) => s.split("\\").join("/")
moduleInternals._load = function (request, parent, isMain) {
  if (request === "pg") return { Pool: class {} }
  if (request === "@prisma/adapter-pg") return { PrismaPg: class {} }
  if (request === "@auth/prisma-adapter") return { PrismaAdapter: () => ({}) }
  if (request === "./generated/prisma" || slashes(request).endsWith("src/generated/prisma")) {
    return { PrismaClient: FakePrismaClient }
  }
  if (request === "@/lib/prisma" || /src\/lib\/prisma(\.ts)?$/.test(slashes(request))) return { prisma: fakePrisma }
  return originalLoad.call(this, request, parent, isMain)
}

// The Next server puts AsyncLocalStorage on globalThis before any request
// storage module loads; do the same so the request scope below works
Object.assign(globalThis, { AsyncLocalStorage })

const load = createRequire(join(ROOT, "package.json"))
type AuthModule = typeof import("../src/auth")
type ApiAccessModule = typeof import("../src/lib/api-access")
type Session = { user?: Record<string, unknown> | null; message?: unknown } | null

const { NextRequest } = load("next/server") as typeof import("next/server")
const { workAsyncStorage } = load("next/dist/server/app-render/work-async-storage.external")
const { workUnitAsyncStorage } = load("next/dist/server/app-render/work-unit-async-storage.external")
const jwt = load("@auth/core/jwt") as typeof import("@auth/core/jwt")
const bcrypt = load("bcryptjs") as typeof import("bcryptjs")

const failures: string[] = []
let checks = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (!ok) failures.push(detail ? `${name} (${detail})` : name)
}

// Auth.js logs expected errors (expired tokens, the broken config below)
// with console.error; they are hidden while a step runs
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

// ── Cookies and requests ──
class Jar {
  cookies = new Map<string, string>()
  take(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";")
      const name = pair.slice(0, pair.indexOf("=")).trim()
      const value = pair.slice(pair.indexOf("=") + 1).trim()
      const cleared = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a))
      if (!value || cleared) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }
}
const HTTP_BASE = "http://localhost:3000"
const HTTPS_BASE = "https://psasync.example.test"
const COOKIE = "authjs.session-token"

async function main() {
  const auth = load(AUTH_FILE) as AuthModule
  const { requireAccess } = load(join(ROOT, "src", "lib", "api-access.ts")) as ApiAccessModule
  const NextAuth = (load("next-auth") as typeof import("next-auth")).default
  const { LOGIN_LOCKED_CODE_PREFIX } = load(join(ROOT, "src", "lib", "password-rules.ts")) as typeof import("../src/lib/password-rules")

  async function call(jar: Jar, base: string, method: "GET" | "POST", path: string, form?: Record<string, string>) {
    const headers: Record<string, string> = { cookie: jar.header() }
    let body: string | undefined
    if (form) {
      headers["content-type"] = "application/x-www-form-urlencoded"
      body = new URLSearchParams(form).toString()
    }
    const req = new NextRequest(base + path, { method, headers, body })
    const res = await (method === "GET" ? auth.handlers.GET(req) : auth.handlers.POST(req))
    jar.take(res)
    return res
  }
  async function signIn(jar: Jar, base: string, email: string, password: string) {
    const csrf = (await (await call(jar, base, "GET", "/api/auth/csrf")).json()) as { csrfToken: string }
    return call(jar, base, "POST", "/api/auth/callback/credentials", {
      csrfToken: csrf.csrfToken,
      email,
      password,
      callbackUrl: base + "/dashboard",
    })
  }
  // Runs fn the way Next runs a route handler, so auth() with no arguments
  // (what requireAccess and every page call) reads this request's headers
  function inRequest<T>(cookie: string, fn: () => Promise<T>): Promise<T> {
    const headers = new Headers({ cookie, host: "localhost:3000", "x-forwarded-proto": "http" })
    const workStore = { route: "/check-auth-session", forceStatic: false, dynamicShouldError: false }
    const requestStore = { type: "request", phase: "action", headers }
    return workAsyncStorage.run(workStore, () => workUnitAsyncStorage.run(requestStore, fn))
  }
  const authNow = (cookie: string) => inRequest(cookie, () => auth.auth() as Promise<Session>)
  const accessNow = (cookie: string) => inRequest(cookie, () => requireAccess())
  const tokenCookie = async (token: Record<string, unknown>) =>
    `${COOKIE}=${await jwt.encode({ token, secret: SECRET, salt: COOKIE, maxAge: 7 * 24 * 60 * 60 })}`

  const password = "check auth session password"
  const hash = await bcrypt.hash(password, 4)
  const base = { companyId: "c1", password: hash, active: true, loginFailedAttempts: 0, loginLockedUntil: null }
  users.push(
    { ...base, id: "u1", name: "Check User", email: "user@check.test" },
    { ...base, id: "u2", name: "Locked User", email: "locked@check.test", loginLockedUntil: new Date(Date.now() + 10 * 60_000) }
  )

  // ── Credentials flow and cookies (d, c) ──
  const jar = new Jar()
  let res = await signIn(jar, HTTP_BASE, "user@check.test", password)
  check("sign in redirects to the callback URL", res.status === 302 && res.headers.get("location") === HTTP_BASE + "/dashboard", `${res.status} ${res.headers.get("location")}`)
  const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith(COOKIE + "=")) ?? ""
  check("http: session cookie is authjs.session-token", !!sessionCookie && jar.cookies.has(COOKIE))
  check("http: session cookie is HttpOnly, SameSite=Lax, Path=/", /;\s*HttpOnly/i.test(sessionCookie) && /;\s*SameSite=Lax/i.test(sessionCookie) && /;\s*Path=\/(;|$)/i.test(sessionCookie), sessionCookie)
  check("http: session cookie is not Secure", !/;\s*Secure/i.test(sessionCookie), sessionCookie)

  const secureJar = new Jar()
  res = await signIn(secureJar, HTTPS_BASE, "user@check.test", password)
  const secureCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-" + COOKIE + "=")) ?? ""
  check("https: session cookie is __Secure-authjs.session-token", !!secureCookie)
  check("https: session cookie is Secure, HttpOnly, SameSite=Lax", /;\s*Secure/i.test(secureCookie) && /;\s*HttpOnly/i.test(secureCookie) && /;\s*SameSite=Lax/i.test(secureCookie), secureCookie)
  check("https: CSRF cookie is __Host-authjs.csrf-token", secureJar.cookies.has("__Host-authjs.csrf-token"))

  res = await quietly(() => signIn(new Jar(), HTTP_BASE, "user@check.test", "wrong password"))
  const wrong = new URL(res.headers.get("location") ?? "", HTTP_BASE)
  check("wrong password returns to /login with CredentialsSignin", wrong.pathname === "/login" && wrong.searchParams.get("error") === "CredentialsSignin", wrong.href)
  users[0].loginFailedAttempts = 0

  res = await quietly(() => signIn(new Jar(), HTTP_BASE, "locked@check.test", password))
  const locked = new URL(res.headers.get("location") ?? "", HTTP_BASE)
  check("locked account carries the lockout code to /login", locked.pathname === "/login" && new RegExp(`^${LOGIN_LOCKED_CODE_PREFIX}\\d+$`).test(locked.searchParams.get("code") ?? ""), locked.href)

  // ── auth() for an active user ──
  const cookie = `${COOKIE}=${jar.cookies.get(COOKIE)}`
  let session = await authNow(cookie)
  check("active user: auth() returns the user", session?.user?.id === "u1" && session.user.companyId === "c1" && !!session.user.access, JSON.stringify(session))
  check("active user: no token fields leak into session.user", !!session?.user && !("sub" in session.user) && !("iat" in session.user) && !("jti" in session.user))
  let access = await accessNow(cookie)
  check("active user: requireAccess passes", access.ctx?.userId === "u1" && !access.response)

  // ── (a) deactivated and deleted users ──
  users[0].active = false
  session = await authNow(cookie)
  check("deactivated user: auth() returns a session whose user is null", session !== null && typeof session === "object" && "user" in session && session.user === null, JSON.stringify(session))
  access = await accessNow(cookie)
  check("deactivated user: requireAccess answers 401", access.response?.status === 401)
  users[0].active = true

  const deleted = await tokenCookie({ id: "gone", companyId: "c1", sub: "gone", signedInAt: Math.floor(Date.now() / 1000) })
  session = await authNow(deleted)
  check("deleted user: auth() returns a session whose user is null", session !== null && typeof session === "object" && session.user === null, JSON.stringify(session))
  check("deleted user: requireAccess answers 401", (await accessNow(deleted)).response?.status === 401)

  // Why auth.ts sets user to null instead of deleting it: the wrapper fills
  // a missing user back in from the raw token. If this changes, re-read
  // next-auth/lib/index.js before relying on either behavior.
  const dropsUser = NextAuth({
    secret: SECRET,
    trustHost: true,
    providers: [],
    session: { strategy: "jwt" },
    callbacks: {
      session({ session: s }) {
        const rest: Partial<typeof s> = { ...s }
        delete rest.user
        return rest as typeof s
      },
    },
  })
  const rawToken = await tokenCookie({ id: "u1", sub: "u1", companyId: "c1" })
  session = (await inRequest(rawToken, () => dropsUser.auth() as Promise<Session>)) as Session
  check("wrapper still fills a deleted user from the raw token", session?.user?.sub === "u1", JSON.stringify(session))

  // ── (b) the absolute cap: the jwt callback returning null ends it ──
  const day = 24 * 60 * 60
  const now = Math.floor(Date.now() / 1000)
  const within = await tokenCookie({ id: "u1", companyId: "c1", sub: "u1", signedInAt: now - 29 * day })
  check("29 days after sign in: still signed in", (await authNow(within))?.user?.id === "u1")
  const past = await tokenCookie({ id: "u1", companyId: "c1", sub: "u1", signedInAt: now - 31 * day })
  check("past the cap: auth() returns null", (await quietly(() => authNow(past))) === null)
  check("past the cap: requireAccess answers 401", (await quietly(() => accessNow(past))).response?.status === 401)
  const capJar = new Jar()
  capJar.cookies.set(COOKIE, past.slice(COOKIE.length + 1))
  res = await call(capJar, HTTP_BASE, "GET", "/api/auth/session")
  check("past the cap: session endpoint answers null and clears the cookie", res.status === 200 && (await res.json()) === null && !capJar.cookies.has(COOKIE))

  // ── A configuration error fails closed ──
  delete process.env.AUTH_SECRET
  const misconfigured = NextAuth({ trustHost: true, providers: [] })
  process.env.AUTH_SECRET = SECRET
  session = await quietly(() => inRequest(cookie, () => misconfigured.auth() as Promise<Session>))
  check("missing secret: auth() returns null, not an error object", session === null, JSON.stringify(session))

  const version = (pkg: string) => (JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8")) as { version: string }).version
  const versions = `next-auth ${version("next-auth")}, @auth/core ${version("@auth/core")}, next ${version("next")}`
  if (failures.length) {
    console.error(`Auth session check failed ${failures.length} of ${checks} checks (${versions}):`)
    for (const f of failures) console.error(`  ${f}`)
    console.error("Read node_modules/next-auth/lib/index.js and src/auth.ts before changing either.")
    process.exit(1)
  }
  console.log(`Auth session check passed: ${checks} checks (${versions}).`)
}

main().catch((err) => {
  console.error("Auth session check could not run:", err)
  process.exit(2)
})
