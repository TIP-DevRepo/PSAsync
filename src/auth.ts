import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { PrismaClient } from "./generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { verifySsoRelayToken } from "@/lib/sso-relay-token"
import { getEffectiveAccess } from "@/lib/permissions"

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
          include: { company: { include: { settings: true } } },
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