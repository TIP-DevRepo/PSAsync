// One-time backfill: creates the Global Admin role for every existing
// Company that doesn't already have one. Safe to re-run, companies that
// already have a Global Admin role (isGlobalAdmin: true) are skipped, and
// the partial unique index on Role(companyId) WHERE isGlobalAdmin backs
// this up at the database level if two runs ever race.
//
// Run manually once per environment, e.g.:
//   npx tsx prisma/backfill-global-admin-role.ts
import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { loadEnvFile } from "process"
import { globalAdminRoleData } from "../src/lib/global-admin-role"

loadEnvFile(".env")

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

  const companies = await prisma.company.findMany({ select: { id: true, name: true } })

  let created = 0
  let skipped = 0

  for (const company of companies) {
    const existing = await prisma.role.findFirst({
      where: { companyId: company.id, isGlobalAdmin: true },
      select: { id: true },
    })
    if (existing) {
      skipped++
      continue
    }

    await prisma.role.create({ data: globalAdminRoleData(company.id) })
    created++
    console.log(`Created Global Admin role for company "${company.name}" (${company.id})`)
  }

  console.log(`Backfill complete: ${created} role(s) created, ${skipped} company(ies) already had one.`)

  await prisma.$disconnect()
  await pool.end()
}

main().catch(console.error)
