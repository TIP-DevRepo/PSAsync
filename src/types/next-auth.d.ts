import { DefaultSession } from "next-auth"
import type { EffectiveAccess } from "@/lib/permissions"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      companyId: string
      // Resolved fresh from the database on every request by the session
      // callback in src/auth.ts, never cached in the login token. Null for a
      // deactivated or deleted user.
      access: EffectiveAccess | null
    } & DefaultSession["user"]
  }

  interface User {
    companyId: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    companyId: string
  }
}
