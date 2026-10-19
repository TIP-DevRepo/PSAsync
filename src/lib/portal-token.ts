import { randomBytes } from "crypto"

// A customer portal token: 32 random bytes, base64url encoded (43
// characters). Every route that creates a quote row passes one explicitly
// for both accessToken and internalAccessToken. The schema's cuid default
// is only a fallback, and quotes that already have a cuid token keep it.
export function newAccessToken(): string {
  return randomBytes(32).toString("base64url")
}

// Staff responses never carry the customer token: the quote UI asks for
// the customer link on demand (GET /api/quotes/[id]/portal-link). The
// internal token stays only where the UI opens the internal preview (the
// quotes list and the quote detail).
export function withoutCustomerToken<T extends { accessToken?: unknown }>(row: T): Omit<T, "accessToken"> {
  const rest: Partial<T> = { ...row }
  delete rest.accessToken
  return rest as Omit<T, "accessToken">
}

// For every other quote response: neither token
export function withoutPortalTokens<T extends { accessToken?: unknown; internalAccessToken?: unknown }>(
  row: T
): Omit<T, "accessToken" | "internalAccessToken"> {
  const rest: Partial<T> = { ...row }
  delete rest.accessToken
  delete rest.internalAccessToken
  return rest as Omit<T, "accessToken" | "internalAccessToken">
}

// The same for a row that may be missing
export function withoutPortalTokensOrNull<T extends { accessToken?: unknown; internalAccessToken?: unknown }>(row: T | null) {
  return row ? withoutPortalTokens(row) : null
}
