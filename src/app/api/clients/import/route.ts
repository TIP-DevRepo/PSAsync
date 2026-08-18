import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const VALID_STATUSES = ["ACTIVE", "PROSPECT", "INACTIVE", "LOST"]

// Strips protocol, www, and trailing slashes so "https://www.acme.com/"
// and "acme.com" are recognized as the same domain for duplicate checks.
function normalizeDomain(website: string): string {
  return website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const companyId = session.user.companyId
  const body = await req.json()
  const rows: Record<string, string>[] = body.rows ?? []

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import" }, { status: 400 })
  }

  // Load existing clients once up front rather than querying per row,
  // so a 500-row import doesn't fire 500 separate duplicate checks.
  const existingClients = await prisma.client.findMany({
    where: { companyId },
    select: { name: true, website: true },
  })
  const existingNames = new Set(existingClients.map((c) => c.name.trim().toLowerCase()))
  const existingDomains = new Set(
    existingClients.filter((c) => c.website).map((c) => normalizeDomain(c.website as string))
  )

  const skipped: { rowNumber: number; reason: string }[] = []
  let createdCount = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2 // +1 for 1-indexing, +1 for the header row

    const name = (row.name ?? "").trim()
    if (!name) {
      skipped.push({ rowNumber, reason: "Missing Company Name" })
      continue
    }

    const website = (row.website ?? "").trim()
    const domain = website ? normalizeDomain(website) : null

    const nameMatches = existingNames.has(name.toLowerCase())
    const domainMatches = domain ? existingDomains.has(domain) : false

    if (nameMatches || domainMatches) {
      skipped.push({
        rowNumber,
        reason: nameMatches
          ? "A client with this name already exists"
          : "A client with this website domain already exists",
      })
      continue
    }

    const statusInput = (row.status ?? "").trim().toUpperCase()
    const status = VALID_STATUSES.includes(statusInput) ? statusInput : "PROSPECT"

    await prisma.client.create({
      data: {
        companyId,
        name,
        email: row.email?.trim() || null,
        phone: row.phone?.trim() || null,
        website: website || null,
        status: status as "ACTIVE" | "PROSPECT" | "INACTIVE" | "LOST",
        paymentTerms: row.paymentTerms?.trim() || null,
        notes: row.notes?.trim() || null,
      },
    })

    // Track this row's name/domain too, so two duplicate rows in the
    // same CSV upload don't both get created.
    existingNames.add(name.toLowerCase())
    if (domain) existingDomains.add(domain)

    createdCount++
  }

  return NextResponse.json({ createdCount, skipped })
}