import { PrismaClient } from "../src/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"
import { loadEnvFile } from "process"

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

  const company = await prisma.company.create({
    data: { name: "TIPINC" },
  })

  const hashedPassword = await bcrypt.hash("Admin1234!", 10)

  const adminRole = await prisma.role.create({
    data: {
      companyId: company.id,
      name: "Admin",
      rank: 100,
      isSystem: true,
      permissions: {
        pages: { clients: true, catalog: true, vendors: true, quotes: true, settings: true },
        quotes: { create: true, edit: true, delete: true, changeStatus: true, approve: true, sendEmail: true, viewAllUsersQuotes: true },
        clients: { create: true, edit: true, delete: true, viewAllClients: true },
        settingsSections: { company: true, users: true, quotes: true, approvalWorkflows: true, notifications: true, integrations: true },
        maxDiscount: 100,
      },
    },
  })

  await prisma.user.create({
    data: {
      companyId: company.id,
      name: "Admin",
      email: "admin@tipinc.ai",
      password: hashedPassword,
      roleId: adminRole.id,
    },
  })

  console.log("Seed complete — admin user created")
  await prisma.$disconnect()
  await pool.end()
}

main().catch(console.error)