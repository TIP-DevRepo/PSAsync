// Errors that reach an API response. An API route never returns a caught
// error's own message (a database or Prisma error says how the app is
// built), only the generic message below, unless the error is a UserError:
// one our own code throws with a message written for the user, such as
// generateAssetTag's "doesn't have a Company Prefix set yet".

export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UserError"
  }
}

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again."

// What a route's catch block may say to the user. Anything that isn't a
// UserError is logged on the server, as its kind, its Prisma code and
// fields when it has them, and the first line of its message, never the
// values it was called with, and the user gets GENERIC_ERROR_MESSAGE.
export function userFacingError(err: unknown, context: string): { message: string; status: 400 | 500 } {
  if (err instanceof UserError) return { message: err.message, status: 400 }
  const e = err as { name?: unknown; code?: unknown; meta?: { target?: unknown }; message?: unknown } | null
  const name = typeof e?.name === "string" ? e.name : typeof err
  const code = typeof e?.code === "string" ? ` ${e.code}` : ""
  const target = Array.isArray(e?.meta?.target) ? ` on ${e.meta.target.join(", ")}` : ""
  const firstLine = typeof e?.message === "string" ? e.message.trim().split("\n")[0].slice(0, 200) : ""
  console.error(`${context} failed: ${name}${code}${target}${firstLine ? `: ${firstLine}` : ""}`)
  return { message: GENERIC_ERROR_MESSAGE, status: 500 }
}
