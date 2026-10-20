// The Microsoft directory (tenant) check for Single Sign-On. Kept free of
// database and network imports so it can be tested on its own.

// A specific Entra directory id. The shared endpoints (common,
// organizations, consumers) would accept accounts from any directory.
export const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// An id token's payload, or null when it can't be read. The signature is
// not checked: the token comes straight from Microsoft's token endpoint
// over TLS in the same request, never from the browser.
export function readIdTokenPayload(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null
  const parts = idToken.split(".")
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

// The tid claim from an id token's payload, or null when it can't be read
export function readIdTokenTenant(idToken: unknown): string | null {
  const tid = readIdTokenPayload(idToken)?.tid
  return typeof tid === "string" && tid ? tid : null
}

export type TenantCheck = "match" | "mismatch" | "skipped"

// Compares the signed in account's directory with the company's configured
// tenant, ignoring case. A configured tenant that isn't a GUID (a domain
// name such as contoso.com) can't be compared with tid, so the check is
// skipped rather than breaking sign in. A GUID tenant with no readable tid
// counts as a mismatch, since the account can't be shown to belong there.
export function checkSsoTenant(configuredTenant: string, idToken: unknown): TenantCheck {
  const configured = configuredTenant.trim()
  if (!TENANT_GUID.test(configured)) return "skipped"
  const tid = readIdTokenTenant(idToken)
  if (!tid) return "mismatch"
  return tid.toLowerCase() === configured.toLowerCase() ? "match" : "mismatch"
}
