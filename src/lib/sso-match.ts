// Which PSAsync user a Microsoft sign in belongs to. Kept free of database
// and network imports so the rules can be tested on their own; the SSO
// callback (src/app/api/sso/callback/route.ts) does the lookups and passes
// the rows in.
import { readIdTokenPayload } from "@/lib/sso-tenant"

// The id token claims the callback reads. oid is the account's object id
// in the directory (the same value as Graph's /me id) and never changes
// for the life of the account. preferred_username is the sign in name;
// email is the mail attribute and is often missing.
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

// The addresses a first sign in may match a stored PSAsync email against,
// sign in name first. Only values shaped like an email address count, and
// they're compared ignoring case.
export function firstSignInEmails(claims: SsoIdTokenClaims | null): string[] {
  if (!claims) return []
  const found: string[] = []
  for (const value of [claims.preferredUsername, claims.email]) {
    if (!value || !/^[^@\s]+@[^@\s]+$/.test(value)) continue
    const lower = value.toLowerCase()
    if (!found.includes(lower)) found.push(lower)
  }
  return found
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
// one of the candidate addresses.
// - The sign in name match wins over the email claim match. Two users in
//   the company with the same address in different case can't be told
//   apart, so that address matches nobody.
// - A Microsoft account id already linked to any other user, in any
//   company, is never linked again.
// - A user already linked to a different Microsoft account is never
//   relinked: the existing link stays and the sign in is refused.
export function decideFirstSignIn(
  emails: string[],
  matches: SsoCandidateUser[],
  msId: string | null,
  linkedToUserId: string | null
): FirstSignInDecision {
  let picked: SsoCandidateUser | null = null
  for (const email of emails) {
    const sameAddress = matches.filter((u) => u.email.toLowerCase() === email)
    if (sameAddress.length === 1) {
      picked = sameAddress[0]
      break
    }
  }
  if (!picked || !picked.active) return { ok: false, error: "no_account_found" }

  if (msId && linkedToUserId && linkedToUserId !== picked.id) return { ok: false, error: "account_already_linked" }
  if (msId && picked.microsoftId && picked.microsoftId !== msId) return { ok: false, error: "account_already_linked" }

  return { ok: true, userId: picked.id }
}
