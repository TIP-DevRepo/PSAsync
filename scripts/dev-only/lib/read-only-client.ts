// Wraps a Prisma client so only reads reach the database, for the read only
// dev scripts (report-file-links.ts, report-duplicate-numbers.ts). Every model method outside
// READ_METHODS, every raw query, and every transaction throws before it
// runs. Type-only imports here, so loading this file never touches the
// database.

import type { PrismaClient } from "@/generated/prisma"

export const READ_METHODS: ReadonlySet<string> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
])

const ALLOWED_CLIENT_METHODS: ReadonlySet<string> = new Set(["$disconnect"])

function refused(name: string): () => never {
  return () => {
    throw new Error(`Read only: ${name} is not allowed`)
  }
}

export function readOnlyClient(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(base, prop) {
      const value: unknown = Reflect.get(base, prop, base)
      if (typeof prop !== "string") return value
      if (prop.startsWith("$")) {
        return ALLOWED_CLIENT_METHODS.has(prop) && typeof value === "function" ? value.bind(base) : refused(prop)
      }
      if (!value || typeof value !== "object") return value
      return new Proxy(value, {
        get(delegate, method) {
          const fn: unknown = Reflect.get(delegate, method, delegate)
          if (typeof method !== "string" || typeof fn !== "function") return fn
          return READ_METHODS.has(method) ? fn.bind(delegate) : refused(`${prop}.${method}`)
        },
      })
    },
  })
}
