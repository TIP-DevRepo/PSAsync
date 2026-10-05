// Shared by the My Account form and the change password API so the UI
// and the server always enforce the same rule. Safe to import on the client.
export const MIN_PASSWORD_LENGTH = 12

// bcrypt only uses the first 72 bytes of a password and silently ignores
// the rest, so anything longer gives a false sense of security
export const MAX_PASSWORD_BYTES = 72

// Wrong current password attempts allowed on My Account before the
// change password form locks for LOCKOUT_MINUTES
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

// Measures in UTF-8 bytes, not string length, because some characters
// (accents, emoji) take more than one byte. TextEncoder works in both the
// browser and Node, so the form and the API share this one helper.
export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
