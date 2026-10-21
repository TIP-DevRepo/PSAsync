// DEV ONLY. Seeds an empty dev database with one company, its admin user,
// and its Global Admin and Everyone roles.
//
// Refuses to run unless DB_NAME is exactly psasync_dev, NODE_ENV is not
// production, and --yes is passed, with the same guard as the dev-only
// scripts (scripts/dev-only/lib/guard.ts), which loads only
// .env.development.local, never .env. Run from the repo root:
//   npm run seed -- --yes
//
// The admin comes only from SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in the
// environment. The seed stops before touching the database when either is
// missing or invalid, and never prints the password. An existing user with
// that email is left as is. The admin must choose a new password on first
// sign in.

import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { globalAdminRoleData } from "../src/lib/global-admin-role"
import { ensureEveryoneRole } from "../src/lib/everyone-role"
import { setUserRoles } from "../src/lib/user-roles"
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordByteLength } from "../src/lib/password-rules"
import { enforceDevGuard } from "../scripts/dev-only/lib/guard"
import { BCRYPT_COST } from "../scripts/dev-only/lib/test-data"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("seed")

// The same shape the user invite (POST /api/users) accepts
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Checked before the database client exists, so a bad value never writes
// anything. Messages name the variable, never the password's value.
function readSeedAdmin(): { email: string; password: string } {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").trim()
  const password = process.env.SEED_ADMIN_PASSWORD ?? ""

  const missing = [!email && "SEED_ADMIN_EMAIL", !password && "SEED_ADMIN_PASSWORD"].filter(Boolean)
  const problems: string[] = []
  if (missing.length > 0) {
    problems.push(`Missing ${missing.join(" and ")}. Set ${missing.length === 1 ? "it" : "them"} in the environment before seeding.`)
  }
  if (email && !EMAIL_SHAPE.test(email)) {
    problems.push("SEED_ADMIN_EMAIL is not a valid email address.")
  }
  // Same rules as choosing a password on My Account
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  if (password && passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    problems.push(`SEED_ADMIN_PASSWORD is too long. Use ${MAX_PASSWORD_BYTES} characters or fewer.`)
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`Refusing to seed: ${problem}`)
    process.exit(1)
  }
  return { email, password }
}

const admin = readSeedAdmin()

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  })

  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  // Emails are unique across every company. An existing user keeps its
  // password and roles, and nothing else is created around it.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: admin.email, mode: "insensitive" } },
    select: { id: true },
  })
  if (existing) {
    console.log(`A user with ${admin.email} already exists. It was left as is and nothing was seeded.`)
    await prisma.$disconnect()
    await pool.end()
    return
  }

  const company = await prisma.company.create({
    data: { name: "TIPINC" },
  })

  const hashedPassword = await bcrypt.hash(admin.password, BCRYPT_COST)

  await prisma.role.create({
    data: {
      companyId: company.id,
      name: "Admin",
      rank: 100,
      isSystem: true,
      permissions: {
        pages: { clients: true, catalog: true, vendors: true, quotes: true, settings: true },
        quotes: { create: true, edit: true, delete: true, changeStatus: true, approve: true, sendEmail: true, viewAllUsersQuotes: true, sendAsOthers: true },
        clients: { create: true, edit: true, delete: true },
        settingsSections: { company: true, users: true, quotes: true, approvalWorkflows: true, notifications: true, integrations: true },
        maxDiscount: 100,
      },
    },
  })

  const globalAdminRole = await prisma.role.create({
    data: globalAdminRoleData(company.id),
  })

  const adminUser = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "Admin",
      email: admin.email,
      password: hashedPassword,
      // Signs in with the seeded password once, then must choose their own
      mustChangePassword: true,
    },
  })
  // Also sets the legacy roleId to match
  await setUserRoles(prisma, adminUser.id, [globalAdminRole.id])

  // Every company gets exactly one implicit Everyone role, with no permissions
  await ensureEveryoneRole(prisma, company.id)

  console.log("Seed complete: admin user, Global Admin role, and Everyone role created")
  console.log(`Admin email: ${admin.email}`)
  console.log("The admin must choose a new password on first sign in.")
  await prisma.$disconnect()
  await pool.end()
}

main().catch(console.error)
