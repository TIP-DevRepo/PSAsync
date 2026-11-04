import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma"
import { withSerialTransactions } from "./serial-transactions"

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

// Queries inside a transaction run one after another on its connection
// (src/lib/serial-transactions.ts)
const adapter = withSerialTransactions(new PrismaPg(pool))

export const prisma =
  globalForPrisma.prisma || new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma