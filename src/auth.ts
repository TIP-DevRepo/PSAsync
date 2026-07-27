import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { PrismaClient } from "./generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { verifySsoRelayToken } from "@/lib/sso-relay-token"
import type { SessionRole } from "./types/next-auth.d"

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

// Shapes a DB user + its Role relation into the flat object stored in the
// session/JWT, so every part of the app reads role info the same way
function toSessionRole(role: { id: string; name: string; rank: number; permissions: unknown } | null): SessionRole | null {
  if (!role) return null
  return {
    id: role.id,
    name: role.name,
    rank: role.rank,
    permissions: role.permissions as Record<string, unknown>,
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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { company: { include: { settings: true } }, role: true },
        })

        if (!user || !user.password) return null

        // Once a company has SSO turned on, password login is fully
        // disabled for every user in that company — no exceptions
        if (user.company?.settings?.ssoEnabled) return null

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!passwordMatch) return null

        return {
          ...user,
          role: toSessionRole(user.role),
        }
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
          include: { role: true },
        })
        if (!user || !user.active) return null

        return {
          ...user,
          role: toSessionRole(user.role),
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        // Fresh sign-in — token starts from what authorize() already
        // fetched, and we stamp when the role was last confirmed
        token.id = user.id
        token.role = (user as any).role
        token.companyId = (user as any).companyId
        token.roleCheckedAt = Date.now()
        return token
      }

      // On every OTHER request, only re-check the database once the
      // refresh window has passed (or if something explicitly asks for
      // an immediate refresh via trigger === "update") — this is what
      // makes role/permission changes take effect without requiring a
      // logout/login, while still avoiding a DB hit on every request
      const ROLE_REFRESH_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes
      const lastChecked = (token.roleCheckedAt as number | undefined) ?? 0
      const dueForRefresh = Date.now() - lastChecked > ROLE_REFRESH_INTERVAL_MS

      if (trigger === "update" || dueForRefresh) {
        const current = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: { role: true },
        })

        // Account deleted or deactivated since login — strip permissions
        // immediately rather than leaving stale access in place
        if (!current || !current.active) {
          token.role = null
        } else {
          token.role = toSessionRole(current.role)
        }
        token.roleCheckedAt = Date.now()
      }

      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as SessionRole | null
        session.user.companyId = token.companyId as string
      }
      return session
    },
  },
})