import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, requireAccess } from "@/lib/api-access"
import { IMPORT_BODY_MAX_BYTES, formatMegabytes } from "@/lib/upload-rules"

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
  const { ctx, response } = await requireAccess({
    permission: "clients.create",
    message: "You do not have permission to create clients",
  })
  if (response) return response

  const companyId = ctx.companyId

  // The browser reads the CSV (at most 2 MB) and posts its rows as JSON.
  // The body is capped here, and every row must be plain text values.
  const tooLarge = `That import is larger than ${formatMegabytes(IMPORT_BODY_MAX_BYTES)}`
  if (Number(req.headers.get("content-length")) > IMPORT_BODY_MAX_BYTES) return apiError(400, tooLarge)
  const raw = await req.text()
  if (Buffer.byteLength(raw) > IMPORT_BODY_MAX_BYTES) return apiError(400, tooLarge)
  let body: { rows?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return apiError(400, "The import could not be read")
  }
  const rawRows = body?.rows ?? []
  const isTextRow = (r: unknown) =>
    !!r && typeof r === "object" && !Array.isArray(r) && Object.values(r).every((v) => typeof v === "string")
  if (!Array.isArray(rawRows) || !rawRows.every(isTextRow)) {
    return apiError(400, "The import could not be read")
  }
  const rows = rawRows as Record<string, string>[]

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
    const prefix = (row.prefix ?? "").trim().toUpperCase() || null

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
        prefix,
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