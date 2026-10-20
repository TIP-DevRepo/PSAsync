// How long a sign in lasts. Read by src/auth.ts and by SessionKeepAlive.
// Kept free of server imports so the client can share the refresh time.
//
// - Idle: the sign in cookie and its token expire SESSION_IDLE_SECONDS
//   after they were last re-issued. Auth.js re-issues them on sign in and
//   whenever /api/auth/session is fetched, which SessionKeepAlive does at
//   most once per SESSION_REFRESH_SECONDS while the dashboard is open.
// - Absolute: SESSION_ABSOLUTE_SECONDS after signing in, the session ends
//   however active it is (sessionAfterCap, run by the jwt callback).
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60
export const SESSION_REFRESH_SECONDS = 24 * 60 * 60
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

// The jwt callback's token after the absolute cap, or null to end the
// session (Auth.js then treats the request as signed out and clears the
// cookie where it can).
// - signing in (user given) stamps signedInAt with now
// - a token without signedInAt was issued before the cap existed. Its iat
//   is when it was last re-issued, which Auth.js moves forward on every
//   refresh, so it is copied into signedInAt once and then stays put. Such
//   a session ends at most SESSION_ABSOLUTE_SECONDS after that issue date.
export function sessionAfterCap<T extends { signedInAt?: unknown; iat?: unknown }>(
  token: T,
  signingIn: boolean,
  now: number
): T | null {
  if (signingIn) return { ...token, signedInAt: now }
  const signedInAt = isTime(token.signedInAt) ? token.signedInAt : isTime(token.iat) ? token.iat : now
  if (now - signedInAt >= SESSION_ABSOLUTE_SECONDS) return null
  return { ...token, signedInAt }
}
