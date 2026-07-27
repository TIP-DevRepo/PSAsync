import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getAdapter } from "@/lib/distributors/registry"
import {
  DistributorKey,
  DISTRIBUTOR_LABELS,
  DistributorProductGroup,
  DistributorSearchResult,
} from "@/lib/distributors/types"
import { generateMockResults, generateMockOffer } from "@/lib/distributors/mock-data"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const query = req.nextUrl.searchParams.get("q")?.trim()
  if (!query) {
    return NextResponse.json({ error: "A search term is required" }, { status: 400 })
  }

  const enabled = await prisma.distributorIntegration.findMany({
    where: { companyId: session.user.companyId, enabled: true },
    orderBy: { priority: "asc" },
  })

  if (enabled.length === 0) {
    return NextResponse.json({
      products: [],
      message:
        "No distributors are enabled yet. Go to Settings → Integrations → Distributor Integrations to connect one.",
    })
  }

  const credsFor = (record: (typeof enabled)[number]) => ({
    apiKey: record.apiKey ?? "",
    clientId: record.clientId ?? "",
    clientSecret: record.clientSecret ?? "",
    partnerId: record.partnerId ?? "",
  })

  const liveRecords = enabled.filter((r) => getAdapter(r.distributor as DistributorKey).isLive)
  const mockRecords = enabled.filter((r) => !getAdapter(r.distributor as DistributorKey).isLive)

  // ─── Discovery pass — every LIVE distributor gets an equal shot at the
  // raw typed query. Keyword-capable distributors (Ingram Micro) run a real
  // keyword search. Non-keyword distributors (TD Synnex) treat the query as
  // an exact part number — either it matches or it legitimately doesn't.
  // No single distributor gates whether a product shows up at all anymore.
  type Discovered = { result: DistributorSearchResult; sandboxMode: boolean }
  const discovered: Discovered[] = []

  await Promise.all(
    liveRecords.map(async (record) => {
      const distributorKey = record.distributor as DistributorKey
      const adapter = getAdapter(distributorKey)
      try {
        const results = await adapter.search(query, credsFor(record), record.sandboxMode)
        results.forEach((result) => discovered.push({ result, sandboxMode: record.sandboxMode }))
      } catch (err) {
        console.error(`${distributorKey} discovery search failed:`, err)
      }
    })
  )

  // ─── Group discoveries into products, deduping by part number (falling
  // back to SKU, then name, if a distributor didn't return one) ───
  const products: DistributorProductGroup[] = []
  const productByKey = new Map<string, DistributorProductGroup>()

  function keyFor(r: DistributorSearchResult) {
    return (r.partNumber || r.sku || r.name).toLowerCase().trim()
  }

  for (const { result } of discovered) {
    const key = keyFor(result)
    let product = productByKey.get(key)
    if (!product) {
      product = {
        id: key,
        name: result.name,
        manufacturer: result.manufacturer,
        partNumber: result.partNumber || result.sku,
        offers: [],
      }
      productByKey.set(key, product)
      products.push(product)
    }
    if (product.offers.some((o) => o.distributorKey === result.distributor)) continue
    product.offers.push({
      distributorKey: result.distributor,
      distributorLabel: DISTRIBUTOR_LABELS[result.distributor],
      sku: result.sku,
      price: result.cost,
      cost: result.cost,
      availability: result.stock,
      found: true,
      isMock: result.isMock,
    })
  }

  // No live distributor connected at all — fall back to fully mock results
  if (liveRecords.length === 0) {
    for (const record of enabled) {
      const mockItems = generateMockResults(query, record.distributor as DistributorKey)
      for (const item of mockItems) {
        products.push({
          id: item.sku.toLowerCase(),
          name: item.name,
          manufacturer: item.manufacturer,
          partNumber: item.sku,
          offers: [
            {
              distributorKey: item.distributor,
              distributorLabel: DISTRIBUTOR_LABELS[item.distributor],
              sku: item.sku,
              price: item.cost,
              cost: item.cost,
              availability: item.stock,
              found: true,
              isMock: true,
            },
          ],
        })
      }
    }
  }

  // ─── Fill-in pass — for every product that WAS found, ask every live
  // distributor that didn't already contribute an offer whether they carry
  // that exact part too. This is what produces "Not Found" boxes alongside
  // the distributors that did find it. ───
  for (const record of liveRecords) {
    const distributorKey = record.distributor as DistributorKey
    const adapter = getAdapter(distributorKey)
    const label = DISTRIBUTOR_LABELS[distributorKey]

    const missing = products.filter((p) => !p.offers.some((o) => o.distributorKey === distributorKey))
    if (missing.length === 0) continue

    await Promise.all(
      missing.map(async (product) => {
        try {
          const results = await adapter.search(product.partNumber, credsFor(record), record.sandboxMode)
          const match = results[0]
          product.offers.push(
            match
              ? {
                  distributorKey,
                  distributorLabel: label,
                  sku: match.sku,
                  price: match.cost,
                  cost: match.cost,
                  availability: match.stock,
                  found: true,
                  isMock: match.isMock,
                }
              : {
                  distributorKey,
                  distributorLabel: label,
                  sku: "",
                  price: 0,
                  cost: 0,
                  availability: 0,
                  found: false,
                  isMock: false,
                }
          )
        } catch (err) {
          console.error(`${distributorKey} fill-in lookup failed:`, err)
          product.offers.push({
            distributorKey,
            distributorLabel: label,
            sku: "",
            price: 0,
            cost: 0,
            availability: 0,
            found: false,
            isMock: false,
          })
        }
      })
    )
  }

  // ─── Mock distributors (D&H, Amazon Business — not live yet) always
  // attach a generated offer to every found product ───
  for (const record of mockRecords) {
    const distributorKey = record.distributor as DistributorKey
    const label = DISTRIBUTOR_LABELS[distributorKey]
    for (const product of products) {
      if (product.offers.some((o) => o.distributorKey === distributorKey)) continue
      const mockOffer = generateMockOffer(product.partNumber, distributorKey)
      product.offers.push({ ...mockOffer, distributorLabel: label })
    }
  }

  const anyLive = products.some((p) => p.offers.some((o) => o.found && !o.isMock))
  const message =
    products.length === 0
      ? "No matches found across any connected distributor for that search."
      : anyLive
      ? "Live results from connected distributors, mixed with mock data for distributors still pending API approval."
      : "These are mock results — real distributor pricing/availability will replace this once your distributors approve API access."

  return NextResponse.json({ products, message })
}