// DEV ONLY. Seeds an empty dev database with one company, its admin user,
// and its Global Admin and Everyone roles.
//
// Refuses to run unless DB_NAME is exactly psasync_dev, NODE_ENV is not
// production, and --yes is passed, with the same guard as the dev-only
// scripts (scripts/dev-only/lib/guard.ts), which loads only
// .env.development.local, never .env. Run from the repo root:
//   npm run seed -- --yes
//
// The admin's password is generated for this run, printed once, and never
// saved anywhere. The admin must choose a new one on first sign in.

import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { globalAdminRoleData } from "../src/lib/global-admin-role"
import { ensureEveryoneRole } from "../src/lib/everyone-role"
import { setUserRoles } from "../src/lib/user-roles"
import { enforceDevGuard } from "../scripts/dev-only/lib/guard"
import { BCRYPT_COST, generatePassword } from "../scripts/dev-only/lib/test-data"

// Must stay first: nothing below may run before the guard has passed
enforceDevGuard("seed")

const ADMIN_EMAIL = "admin@tipinc.ai"

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

  const company = await prisma.company.create({
    data: { name: "TIPINC" },
  })

  // A fresh random password every run, kept only in memory
  const password = generatePassword(20)
  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)

  const adminRole = await prisma.role.create({
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

  const adminUser = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "Admin",
      email: ADMIN_EMAIL,
      password: hashedPassword,
      // Signs in with the printed password once, then must choose their own
      mustChangePassword: true,
    },
  })
  // Also sets the legacy roleId to match
  await setUserRoles(prisma, adminUser.id, [adminRole.id])

  await prisma.role.create({
    data: globalAdminRoleData(company.id),
  })

  // Every company gets exactly one implicit Everyone role, with no permissions
  await ensureEveryoneRole(prisma, company.id)

  console.log("Seed complete: admin user, Global Admin role, and Everyone role created")
  console.log(`Admin email: ${ADMIN_EMAIL}`)
  console.log(`Admin password (shown only now, never saved): ${password}`)
  console.log("The admin must choose a new password on first sign in.")
  await prisma.$disconnect()
  await pool.end()
}

main().catch(console.error)
