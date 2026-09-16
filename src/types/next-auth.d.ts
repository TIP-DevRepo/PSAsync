import { DefaultSession } from "next-auth"

export interface SessionRole {
  id: string
  name: string
  rank: number
  isGlobalAdmin: boolean
  permissions: Record<string, unknown>
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      companyId: string
      role: SessionRole | null
    } & DefaultSession["user"]
  }

  interface User {
    companyId: string
    role: SessionRole | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    companyId: string
    role: SessionRole | null
  }
}