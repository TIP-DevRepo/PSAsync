import {
  DistributorAdapter,
  DistributorCredentials,
  DistributorSearchResult,
  TestConnectionResult,
} from "./types"

// TIPINC is US-based — change this if that's ever not true. D&H's header
// values are dhus (US), dhca (Canada), dsc (a third D&H entity).
const DANDH_TENANT = "dhus"

// UNCONFIRMED: only the sandbox host (test.api.dandh.com) and the OAuth
// token host pattern (test.auth.dandh.com -> auth.dandh.com) are actually
// documented. The production API host below (api.dandh.com) follows that
// same pattern but has NOT been confirmed against D&H's own docs or
// portal — verify this before relying on production calls.
function getApiBasePath(sandboxMode: boolean) {
  return sandboxMode ? "https://test.api.dandh.com" : "https://api.dandh.com"
}

function getTokenUrl(sandboxMode: boolean) {
  return sandboxMode
    ? "https://test.auth.dandh.com/api/oauth/token"
    : "https://auth.dandh.com/api/oauth/token"
}

async function getAccessToken(
  creds: DistributorCredentials,
  sandboxMode: boolean
): Promise<string> {
  const res = await fetch(getTokenUrl(sandboxMode), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "resource.READ",
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "")
    throw new Error(`D&H auth failed: ${res.status} ${res.statusText} — ${bodyText}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error("No access token returned")
  }
  return data.access_token
}

interface DHCatalogItem {
  itemId?: string
  vendorItemId?: string
  vendorName?: string
  description?: string
  estimatedRetailPrice?: string
}

interface DHCatalogResponse {
  elements?: DHCatalogItem[]
  scrollId?: string
  hasNext?: boolean
}

interface DHPriceAvailabilityItem {
  itemId?: string
  salesPrice?: string
  totalAvailableQuantity?: number
}

async function getPriceAndAvailability(
  itemIds: string[],
  accessToken: string,
  accountNumber: string,
  sandboxMode: boolean
): Promise<Map<string, DHPriceAvailabilityItem>> {
  const map = new Map<string, DHPriceAvailabilityItem>()
  if (itemIds.length === 0) return map

  const params = new URLSearchParams()
  itemIds.forEach((id) => params.append("items", id))

  const url = `${getApiBasePath(sandboxMode)}/customerOrderManagement/v2/customers/${accountNumber}/items/priceAndAvailability/bulk?${params.toString()}`

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "dandh-tenant": DANDH_TENANT,
      },
    })

    if (!res.ok) {
      console.error("D&H price/availability call failed:", res.status, res.statusText)
      return map // return empty map — search results still show, just without live price/stock
    }

    const data: DHPriceAvailabilityItem[] = await res.json()
    for (const item of data ?? []) {
      if (item.itemId) map.set(item.itemId, item)
    }
  } catch (err) {
    console.error("D&H price/availability call failed:", err)
  }

  return map
}

export const dhAdapter: DistributorAdapter = {
  key: "DH",
  label: "D&H",
  isLive: true,
  // D&H's catalog "description" filter is documented as a query param, not
  // an explicit fuzzy/keyword search like Ingram's — treat as a best-effort
  // keyword search and verify real-world matching behavior once live.
  supportsKeywordSearch: true,

  async testConnection(
    creds: DistributorCredentials,
    sandboxMode = true
  ): Promise<TestConnectionResult> {
    try {
      await getAccessToken(creds, sandboxMode)
      return {
        success: true,
        status: `Connected (${sandboxMode ? "Sandbox" : "Production"})`,
      }
    } catch (err) {
      return {
        success: false,
        status: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      }
    }
  },

  async search(
    query: string,
    creds: DistributorCredentials,
    sandboxMode = true
  ): Promise<DistributorSearchResult[]> {
    const accessToken = await getAccessToken(creds, sandboxMode)

    // apiKey field is repurposed to store D&H's 10-digit customer account
    // number, the same way the Ingram adapter repurposes it for their
    // Customer Number — D&H doesn't have a separate "API key" concept
    // either, everything after the OAuth token hinges on the account number.
    const accountNumber = creds.apiKey

    const searchParams = new URLSearchParams({
      description: query,
      pageSize: "10",
    })

    const catalogUrl = `${getApiBasePath(sandboxMode)}/catalog/v1/customers/${accountNumber}/items?${searchParams.toString()}`

    // TEMPORARY DEBUG LOGGING — remove once search is confirmed working.
    console.log("[D&H DEBUG] catalog request URL:", catalogUrl)

    const catalogRes = await fetch(catalogUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "dandh-tenant": DANDH_TENANT,
      },
    })

    const rawBody = await catalogRes.text()
    console.log("[D&H DEBUG] catalog response status:", catalogRes.status)
    console.log("[D&H DEBUG] catalog response body:", rawBody)

    if (!catalogRes.ok) {
      // A 404 on a list endpoint would be unusual (D&H's docs suggest an
      // empty array for no matches, not a 404) — but treat it the same as
      // Ingram's "no results" case just in case, rather than surfacing an
      // error for what's really just zero matches.
      if (catalogRes.status === 404) return []
      throw new Error(`D&H catalog search failed: ${catalogRes.status} ${catalogRes.statusText}`)
    }

    const catalogResponse: DHCatalogResponse = rawBody ? JSON.parse(rawBody) : {}
    const catalogItems: DHCatalogItem[] = catalogResponse.elements ?? []

    const searchResults: DistributorSearchResult[] = catalogItems.map((item) => ({
      name: item.description ?? "Unknown item",
      manufacturer: item.vendorName ?? "",
      partNumber: item.vendorItemId ?? "",
      sku: item.itemId ?? "",
      msrp: Number(item.estimatedRetailPrice) || 0,
      cost: 0,
      stock: 0,
      leadTime: "Check availability",
      distributor: "DH" as const,
      isMock: false,
    }))

    // Fetch real price/stock for the products we just found and merge it
    // in. If this call fails for any reason, we still return the search
    // results above with price/stock left at 0 rather than losing the
    // results entirely — same fallback behavior as the Ingram adapter.
    const itemIds = searchResults.map((r) => r.sku).filter(Boolean)
    const paMap = await getPriceAndAvailability(itemIds, accessToken, accountNumber, sandboxMode)

    return searchResults.map((r) => {
      const pa = paMap.get(r.sku)
      const availableQty = pa?.totalAvailableQuantity ?? 0
      return {
        ...r,
        // D&H's priceAndAvailability response only returns one "salesPrice"
        // field — this is what D&H charges you (your cost), not a separate
        // suggested-retail figure. msrp above comes from the Catalog API's
        // estimatedRetailPrice instead.
        cost: Number(pa?.salesPrice) || 0,
        stock: availableQty,
        leadTime: availableQty > 0 ? "In Stock" : "Check availability",
      }
    })
  },
}