import { randomBytes } from "crypto"

// A customer portal token: 32 random bytes, base64url encoded (43
// characters). Every route that creates a quote row passes one explicitly
// for both accessToken and internalAccessToken. The schema's cuid default
// is only a fallback, and quotes that already have a cuid token keep it.
export function newAccessToken(): string {
  return randomBytes(32).toString("base64url")
}
