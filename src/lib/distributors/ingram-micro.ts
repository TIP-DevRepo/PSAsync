import {
  DistributorAdapter,
  DistributorCredentials,
  DistributorSearchResult,
  TestConnectionResult,
} from "./types"
import XiSdkResellers from "xi_sdk_resellers"

// TIPINC is US-based — change this if that's ever not true
const COUNTRY_CODE = "US"

function getBasePath(sandboxMode: boolean) {
  return sandboxMode
    ? "https://api.ingrammicro.com:443/sandbox"
    : "https://api.ingrammicro.com:443"
}

// Ingram Micro rejects any IM-CorrelationID longer than 32 characters —
// crypto.randomUUID() is 36 with dashes, so we strip them
function newCorrelationId(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

async function getAccessToken(
  creds: DistributorCredentials,
  _sandboxMode: boolean
): Promise<string> {
  const client = new XiSdkResellers.ApiClient()
  // The OAuth token endpoint has no sandbox variant — always production
  client.basePath = "https://api.ingrammicro.com:443"
  const api = new XiSdkResellers.AccesstokenApi(client)

  return new Promise((resolve, reject) => {
    api.getAccesstoken(
      "client_credentials",
      creds.clientId,
      creds.clientSecret,
      (error: unknown, data: { access_token?: string }) => {
        if (error || !data?.access_token) {
          reject(error ?? new Error("No access token returned"))
        } else {
          resolve(data.access_token)
        }
      }
    )
  })
}

interface PriceAndAvailabilityItem {
  ingramPartNumber?: string
  availability?: { totalAvailability?: number }
  pricing?: { customerPrice?: number; retailPrice?: number }
}

async function getPriceAndAvailability(
  ingramPartNumbers: string[],
  creds: DistributorCredentials,
  sandboxMode: boolean,
  accessToken: string,
  imCustomerNumber: string
): Promise<Map<string, PriceAndAvailabilityItem>> {
  const map = new Map<string, PriceAndAvailabilityItem>()
  if (ingramPartNumbers.length === 0) return map

  const client = new XiSdkResellers.ApiClient()
  client.basePath = getBasePath(sandboxMode)
  client.authentications["application"].accessToken = accessToken
  const api = new XiSdkResellers.ProductCatalogApi(client)

  const requestBody = {
    products: ingramPartNumbers.map((ingramPartNumber) => ({
      ingramPartNumber,
      quantityRequested: "1",
    })),
  }

  return new Promise((resolve) => {
    api.postPriceandavailability(
      true, // includeAvailability
      true, // includePricing
      imCustomerNumber,
      COUNTRY_CODE,
      newCorrelationId(),
      { priceAndAvailabilityRequest: requestBody },
      (error: unknown, data: PriceAndAvailabilityItem[]) => {
        if (error) {
          console.error("Ingram Micro price/availability call failed:", error)
          resolve(map) // return empty map — search results still show, just without live price/stock
          return
        }
        for (const item of data ?? []) {
          if (item.ingramPartNumber) {
            map.set(item.ingramPartNumber, item)
          }
        }
        resolve(map)
      }
    )
  })
}

export const ingramMicroAdapter: DistributorAdapter = {
  key: "INGRAM_MICRO",
  label: "Ingram Micro",
  isLive: true,
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

    const client = new XiSdkResellers.ApiClient()
    client.basePath = getBasePath(sandboxMode)
    client.authentications["application"].accessToken = accessToken
    const api = new XiSdkResellers.ProductCatalogApi(client)

    // apiKey field is repurposed to store the IM Customer Number
    // (Ingram doesn't use a separate "API key" concept)
    const imCustomerNumber = creds.apiKey

    const searchResults = await new Promise<DistributorSearchResult[]>((resolve, reject) => {
      api.getResellerV6Productsearch(
        imCustomerNumber,
        newCorrelationId(),
        COUNTRY_CODE,
        { pageNumber: 1, pageSize: 10, keyword: [query] },
        (error: unknown, data: { catalog?: Array<Record<string, unknown>> }) => {
          // A 404 here just means nothing matched the keyword — a normal
          // empty search result, not a real failure
          const status = (error as { status?: number })?.status
          if (error && status === 404) {
            resolve([])
            return
          }
          if (error) {
            reject(error)
            return
          }
          const items = (data?.catalog ?? []).map((item) => ({
            name: String(item.description ?? item.productName ?? "Unknown item"),
            manufacturer: String(item.vendorName ?? ""),
            partNumber: String(item.vendorPartNumber ?? ""),
            sku: String(item.ingramPartNumber ?? ""),
            msrp: 0,
            cost: 0,
            stock: 0,
            leadTime: "Check availability",
            distributor: "INGRAM_MICRO" as const,
            isMock: false,
          }))
          resolve(items)
        }
      )
    })

    // Fetch real price/stock for the products we just found and merge it in.
    // If this call fails for any reason, we still return the search results
    // above with price/stock left at 0 rather than losing the results entirely.
    const skus = searchResults.map((r) => r.sku).filter(Boolean)
    const paMap = await getPriceAndAvailability(
      skus,
      creds,
      sandboxMode,
      accessToken,
      imCustomerNumber
    )

    return searchResults.map((r) => {
      const pa = paMap.get(r.sku)
      return {
        ...r,
        msrp: pa?.pricing?.retailPrice ?? 0,
        cost: pa?.pricing?.customerPrice ?? 0,
        stock: pa?.availability?.totalAvailability ?? 0,
        leadTime:
          pa?.availability?.totalAvailability && pa.availability.totalAvailability > 0
            ? "In Stock"
            : "Check availability",
      }
    })
  },
}