// Safety guard for the dev-only test scripts. Every script in
// scripts/dev-only calls enforceDevGuard() before it imports the database
// client or makes any network request, so nothing here can ever run
// against the live database.
//
// The app's database connection (src/lib/prisma.ts) is built from DB_HOST,
// DB_NAME, DB_USER, and DB_PASSWORD, not DATABASE_URL, so DB_NAME is what
// this checks. The production .env uses a different DB_NAME on the same
// host, so the exact dev name is the one reliable signal.

import { loadEnvFile } from "process"

export const DEV_DB_NAME = "psasync_dev"
export const CONFIRM_FLAG = "--yes"

// The dev database settings `next dev` uses. Never .env, which is
// production. loadEnvFile never overrides a variable already set in the
// shell, and the guard below checks whatever ends up set either way.
export const DEV_ENV_FILE = ".env.development.local"

export type GuardResult =
  | { ok: true; host: string; name: string }
  | { ok: false; reason: string; host: string; name: string }

// Pure check, no side effects, so it can be tested on its own
export function checkDevGuard(env: Record<string, string | undefined>, argv: readonly string[]): GuardResult {
  const host = env.DB_HOST || "(not set)"
  const name = env.DB_NAME || "(not set)"

  if (env.DB_NAME !== DEV_DB_NAME) {
    return { ok: false, host, name, reason: `DB_NAME must be exactly "${DEV_DB_NAME}", got ${env.DB_NAME ? `"${env.DB_NAME}"` : "nothing"}` }
  }
  if (env.NODE_ENV === "production") {
    return { ok: false, host, name, reason: "NODE_ENV is production" }
  }
  if (!argv.includes(CONFIRM_FLAG)) {
    return { ok: false, host, name, reason: `the ${CONFIRM_FLAG} flag is required to proceed` }
  }
  return { ok: true, host, name }
}

export interface EnforceOptions {
  env?: Record<string, string | undefined>
  argv?: readonly string[]
  // null skips loading a file, for tests
  envFile?: string | null
  exit?: (code: number) => never
  log?: (message: string) => void
}

// Loads the dev env file, prints the target database (host and name only,
// never a password or connection string), and exits with code 1 unless
// the guard passes
export function enforceDevGuard(scriptName: string, options: EnforceOptions = {}): { host: string; name: string } {
  const env = options.env ?? process.env
  const argv = options.argv ?? process.argv.slice(2)
  const envFile = options.envFile === undefined ? DEV_ENV_FILE : options.envFile
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const log = options.log ?? ((message: string) => console.log(message))

  if (envFile && env === process.env) {
    try {
      loadEnvFile(envFile)
    } catch {
      log(`Note: ${envFile} was not found, using only the variables already set in this shell.`)
    }
  }

  const result = checkDevGuard(env, argv)
  log(`${scriptName}: database host ${result.host}, database name ${result.name}`)

  if (!result.ok) {
    log(`Refusing to run: ${result.reason}.`)
    log(`These scripts only ever run against the dev database "${DEV_DB_NAME}", with ${CONFIRM_FLAG} on the command line.`)
    return exit(1)
  }
  return { host: result.host, name: result.name }
}
