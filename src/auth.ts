import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { PrismaClient } from "./generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { verifySsoRelayToken } from "@/lib/sso-relay-token"
import { getEffectiveAccess } from "@/lib/permissions"
import { MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES, LOGIN_LOCKED_CODE_PREFIX } from "@/lib/password-rules"

const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// A bcrypt hash of a random throwaway value (same cost factor as real
// passwords), compared against when there's no real hash to check, so
// those refusals take as long as a wrong password. Nothing matches it.
const DUMMY_PASSWORD_HASH = "$2b$10$5oOqChS6mhKzuyTdZOwu0ONZA3pwW8rXFRJ77aVoOBfmXFvH8uIFS"

// Sent to the login page as the sign in error code, e.g. "locked_15", which
// it turns into the "Too many sign in attempts" message. Auth.js puts the
// code in a URL, so it carries only the minutes left, nothing else.
class LoginLockedError extends CredentialsSignin {
  constructor(lockedUntil: Date) {
    super()
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000))
    this.code = `${LOGIN_LOCKED_CODE_PREFIX}${minutes}`
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      id: "credentials",
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const password = credentials.password as string

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { company: { include: { settings: true } } },
        })

        // Every refusal below that skips the real comparison still runs a
        // bcrypt compare, so an unknown email takes as long as a wrong
        // password and the two can't be told apart by timing
        if (!user || !user.password) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
          return null
        }

        // Checked before any password comparison, so a locked account can't
        // keep guessing while it waits
        const lockedUntil = user.loginLockedUntil
        if (lockedUntil && lockedUntil.getTime() > Date.now()) {
          throw new LoginLockedError(lockedUntil)
        }

        // An expired lock means the counter starts over. Matching on the
        // exact lock value means only one of several simultaneous requests
        // resets it, so a reset can't wipe out a wrong attempt counted in
        // the meantime.
        if (lockedUntil) {
          await prisma.user.updateMany({
            where: { id: user.id, loginLockedUntil: lockedUntil },
            data: { loginFailedAttempts: 0, loginLockedUntil: null },
          })
        }

        // Once a company has SSO turned on, password login is fully
        // disabled for every user in that company, no exceptions.
        // Neither this nor an inactive account counts toward the lockout.
        if (!user.active || user.company?.settings?.ssoEnabled) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
          return null
        }

        const passwordMatch = await bcrypt.compare(password, user.password)

        // Only a wrong password for an existing active account counts. The
        // increment is a single atomic update, so simultaneous requests
        // can't both read the same count and slip past the limit.
        if (!passwordMatch) {
          const { loginFailedAttempts: attempts } = await prisma.user.update({
            where: { id: user.id },
            data: { loginFailedAttempts: { increment: 1 } },
            select: { loginFailedAttempts: true },
          })

          if (attempts >= MAX_FAILED_ATTEMPTS) {
            const newLock = new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            await prisma.user.update({
              where: { id: user.id },
              data: { loginFailedAttempts: 0, loginLockedUntil: newLock },
            })
            throw new LoginLockedError(newLock)
          }

          return null
        }

        // A successful login starts the counter over. Skipped when there's
        // nothing to clear, so an ordinary login doesn't write to the row.
        if (user.loginFailedAttempts > 0 || user.loginLockedUntil) {
          await prisma.user.update({
            where: { id: user.id },
            data: { loginFailedAttempts: 0, loginLockedUntil: null },
          })
        }

        return user
      },
    }),
    // Used only internally by /api/sso/callback after a verified Microsoft
    // sign-in — never exposed as a login option a user picks directly
    Credentials({
      id: "sso",
      name: "sso",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) return null

        const verified = verifySsoRelayToken(credentials.token as string)
        if (!verified) return null

        const user = await prisma.user.findUnique({
          where: { id: verified.userId },
        })
        if (!user || !user.active) return null

        return user
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // The token only carries identity. Roles and permissions are never
      // stored here, they're resolved from the database per request in
      // session() below, so a role change applies on the next page load.
      if (user) {
        token.id = user.id as string
        token.companyId = user.companyId
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.companyId = token.companyId as string
        // Runs server side for every auth() call and /api/auth/session
        // fetch. getEffectiveAccess is cached per request, so a page that
        // calls auth() several times only queries once. Null for a
        // deactivated or deleted account, which strips all access.
        session.user.access = await getEffectiveAccess(token.id as string)
      }
      return session
    },
  },
})