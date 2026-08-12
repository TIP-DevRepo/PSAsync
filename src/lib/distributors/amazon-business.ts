import {
  DistributorAdapter,
  DistributorCredentials,
  DistributorSearchResult,
  TestConnectionResult,
} from "./types"

// Amazon Business's DistributorCredentials fields are repurposed since it
// needs 4 different values than the other distributors:
//   clientId     -> LWA Client ID (as normal)
//   clientSecret -> LWA Client Secret (as normal)
//   apiKey       -> the email address tied to your Amazon Business account
//                   (required on every call via x-amz-user-email)
//   partnerId    -> the refresh token generated in the Solution Provider
//                   Portal (production: via the OAuth consent flow;
//                   sandbox: via the "Create token" action)

function getBasePath(sandboxMode: boolean) {
  return sandboxMode
    ? "https://sandbox.na.business-api.amazon.com"
    : "https://na.business-api.amazon.com"
}

async function getAccessToken(creds: DistributorCredentials): Promise<string> {
  const res = await fetch("https://api.amazon.com/auth/O2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.partnerId,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "")
    throw new Error(`Amazon Business auth failed: ${res.status} ${res.statusText} — ${bodyText}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error("No access token returned")
  }
  return data.access_token
}

// The exact field names inside each offer are UNCONFIRMED beyond what's
// visible in Amazon's docs excerpts ("the actual price the customers
// pay" / "the price of the product without tax") — the full ProductsResult
// schema wasn't fully available to verify field-by-field. This shape is a
// best-effort mapping; treat it as provisional until a real sandbox
// response can be inspected and compared.
interface AmazonOffer {
  price?: { value?: number; currencyCode?: string }
  merchantInfo?: { name?: string }
  availability?: { type?: string; message?: string }
}

interface AmazonProduct {
  asin?: string
  title?: { displayString?: string } | string
  brand?: { displayString?: string } | string
  includedDataTypes?: {
    OFFERS?: AmazonOffer[]
  }
}

interface AmazonProductsResult {
  products?: AmazonProduct[]
}

function extractText(field: { displayString?: string } | string | undefined): string {
  if (!field) return ""
  if (typeof field === "string") return field
  return field.displayString ?? ""
}

export const amazonBusinessAdapter: DistributorAdapter = {
  key: "AMAZON_BUSINESS",
  label: "Amazon Business",
  isLive: true,
  supportsKeywordSearch: true,

  async testConnection(
    creds: DistributorCredentials,
    _sandboxMode = true
  ): Promise<TestConnectionResult> {
    try {
      await getAccessToken(creds)
      return { success: true, status: "Connected" }
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
    const accessToken = await getAccessToken(creds)

    const searchParams = new URLSearchParams({
      productRegion: "US",
      locale: "en_US",
      facets: "OFFERS",
      keywords: query,
    })

    const url = `${getBasePath(sandboxMode)}/products/2020-08-26/products?${searchParams.toString()}`

    const res = await fetch(url, {
      headers: {
        "x-amz-access-token": accessToken,
        // Mandatory on every call per Amazon's own FAQ docs — omitting
        // this causes a distinct "email is a mandatory parameter" error,
        // separate from a missing/expired access token error.
        "x-amz-user-email": creds.apiKey,
      },
    })

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "")
      // The static sandbox only recognizes a small set of pre-canned
      // magic input values ("keywords=keyword" being the one confirmed
      // example) and rejects anything else with a 400 InvalidInput, even
      // well-formed real-world queries. This is expected sandbox
      // behavior, not a real failure — degrade gracefully to an empty
      // result rather than throwing, so one distributor's sandbox
      // limitation doesn't disrupt search results from others.
      console.error(`Amazon Business search returned ${res.status}:`, bodyText)
      return []
    }

    const data: AmazonProductsResult = await res.json()
    const products = data.products ?? []

    return products.map((p) => {
      const offer = p.includedDataTypes?.OFFERS?.[0]
      return {
        name: extractText(p.title) || "Unknown item",
        manufacturer: extractText(p.brand),
        partNumber: p.asin ?? "",
        sku: p.asin ?? "",
        msrp: offer?.price?.value ?? 0,
        cost: offer?.price?.value ?? 0,
        stock: offer?.availability?.type === "IN_STOCK" ? 1 : 0,
        leadTime: offer?.availability?.message ?? "Check availability",
        distributor: "AMAZON_BUSINESS" as const,
        isMock: false,
      }
    })
  },
}