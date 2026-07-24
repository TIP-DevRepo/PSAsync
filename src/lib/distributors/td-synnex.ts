import {
  DistributorAdapter,
  DistributorCredentials,
  DistributorSearchResult,
  TestConnectionResult,
} from "./types"

// TD Synnex's OAuth token endpoint is shared across all regions/environments —
// which sandbox vs. production token you get back depends on which
// credentials you send, not the URL you send them to
const TOKEN_URL = "https://sso.us.tdsynnex.com/oauth2/v1/token"

function getBasePath(sandboxMode: boolean) {
  return sandboxMode
    ? "https://api-uat.us.tdsynnex.com"
    : "https://api.us.tdsynnex.com"
}

async function getAccessToken(creds: DistributorCredentials): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  })

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error("No access token returned")
  }
  return data.access_token
}

interface PriceAvailabilityItem {
  mfgPN?: string
  synnexSKU?: number
  status?: string
  description?: string
  price?: string | null
  msrp?: string | null
  totalQuantity?: number | null
}

interface PriceAvailabilityResponse {
  PriceAvailabilityList?: PriceAvailabilityItem[]
  errorMessage?: string | null
  errorDetail?: string | null
}

export const tdSynnexAdapter: DistributorAdapter = {
  key: "TD_SYNNEX",
  label: "TD Synnex",
  isLive: true,

  async testConnection(
    creds: DistributorCredentials,
    sandboxMode = true
  ): Promise<TestConnectionResult> {
    try {
      await getAccessToken(creds)
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

  // IMPORTANT: TD Synnex has no keyword/catalog search endpoint — only exact
  // lookup by SKU or manufacturer part number. We treat the incoming query
  // as a manufacturer part number. A keyword like "monitor" will legitimately
  // come back with zero matches — that's expected, not an error.
  async search(
    query: string,
    creds: DistributorCredentials,
    sandboxMode = true
  ): Promise<DistributorSearchResult[]> {
    const accessToken = await getAccessToken(creds)

    const res = await fetch(
      `${getBasePath(sandboxMode)}/api/v1/webservice/json/GetPriceAvailability`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          version: "2.8",
          skuList: [{ mfgPN: query, lineNumber: 1, priceType: "REGULAR" }],
        }),
      }
    )

    if (!res.ok) {
      throw new Error(`TD Synnex request failed: ${res.status} ${res.statusText}`)
    }

    const data: PriceAvailabilityResponse = await res.json()

    // A top-level errorMessage means something actually went wrong
    // (auth, malformed request) — different from a per-item "Not found"
    if (data.errorMessage) {
      throw new Error(data.errorMessage)
    }

    const items = data.PriceAvailabilityList ?? []

    return items
      .filter((item) => item.status === "Active")
      .map((item) => ({
        name: item.description ?? "Unknown item",
        manufacturer: "",
        partNumber: item.mfgPN ?? query,
        sku: item.synnexSKU ? String(item.synnexSKU) : "",
        msrp: item.msrp ? Number(item.msrp) : 0,
        cost: item.price ? Number(item.price) : 0,
        stock: item.totalQuantity ?? 0,
        leadTime:
          item.totalQuantity && item.totalQuantity > 0
            ? "In Stock"
            : "Check availability",
        distributor: "TD_SYNNEX" as const,
        isMock: false,
      }))
  },
}