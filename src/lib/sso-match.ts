// Which PSAsync user a Microsoft sign in belongs to. Kept free of database
// and network imports so the rules can be tested on their own; the SSO
// callback (src/app/api/sso/callback/route.ts) does the lookups and passes
// the rows in.
import { readIdTokenPayload } from "@/lib/sso-tenant"

// The id token claims the callback reads. oid is the account's object id
// in the directory (the same value as Graph's /me id) and never changes
// for the life of the account. preferred_username is the sign in name
// (UPN). email is the directory mail attribute, which an admin can set to
// any address, so it is read but never used to decide who signs in.
export interface SsoIdTokenClaims {
  oid: string | null
  preferredUsername: string | null
  email: string | null
}

function claim(payload: Record<string, unknown>, name: string): string | null {
  const value = payload[name]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function readSsoClaims(idToken: unknown): SsoIdTokenClaims | null {
  const payload = readIdTokenPayload(idToken)
  if (!payload) return null
  return {
    oid: claim(payload, "oid"),
    preferredUsername: claim(payload, "preferred_username"),
    email: claim(payload, "email"),
  }
}

// The one address a first sign in may match a stored PSAsync email
// against: the sign in name (preferred_username, the UPN), lower case, and
// only when it is shaped like an email address. Null when it is missing,
// which refuses the sign in. The email claim is never used.
export function firstSignInName(claims: SsoIdTokenClaims | null): string | null {
  const value = claims?.preferredUsername
  if (!value || !/^[^@\s]+@[^@\s]+$/.test(value)) return null
  return value.toLowerCase()
}

export interface SsoCandidateUser {
  id: string
  email: string
  active: boolean
  microsoftId: string | null
}

export type FirstSignInDecision =
  | { ok: true; userId: string }
  | { ok: false; error: "no_account_found" | "account_already_linked" }

// Picks the user for a first sign in (no user in the company holds this
// Microsoft account id yet) from the company's users whose email matched
// the sign in name (firstSignInName).
// - Exact match ignoring case. Two users in the company with the same
//   address in different case can't be told apart, so that address
//   matches nobody.
// - A Microsoft account id already linked to any other user, in any
//   company, is never linked again.
// - A user already linked to a different Microsoft account is never
//   relinked: the existing link stays and the sign in is refused.
export function decideFirstSignIn(
  signInName: string,
  matches: SsoCandidateUser[],
  msId: string | null,
  linkedToUserId: string | null
): FirstSignInDecision {
  const sameAddress = matches.filter((u) => u.email.toLowerCase() === signInName.toLowerCase())
  const picked = sameAddress.length === 1 ? sameAddress[0] : null
  if (!picked || !picked.active) return { ok: false, error: "no_account_found" }

  if (msId && linkedToUserId && linkedToUserId !== picked.id) return { ok: false, error: "account_already_linked" }
  if (msId && picked.microsoftId && picked.microsoftId !== msId) return { ok: false, error: "account_already_linked" }

  return { ok: true, userId: picked.id }
}
