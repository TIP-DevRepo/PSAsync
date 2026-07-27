export type DistributorKey =
  | "INGRAM_MICRO"
  | "TD_SYNNEX"
  | "DH"
  | "AMAZON_BUSINESS"

export const DISTRIBUTOR_LABELS: Record<DistributorKey, string> = {
  INGRAM_MICRO: "Ingram Micro",
  TD_SYNNEX: "TD Synnex",
  DH: "D&H",
  AMAZON_BUSINESS: "Amazon Business",
}

export interface DistributorCredentials {
  apiKey: string
  clientId: string
  clientSecret: string
  partnerId: string
}

export interface DistributorSearchResult {
  name: string
  manufacturer: string
  partNumber: string
  sku: string
  msrp: number
  cost: number
  stock: number
  leadTime: string
  distributor: DistributorKey
  isMock: boolean
}

export interface TestConnectionResult {
  success: boolean
  status: string
}

// One distributor's price/stock offer for a specific product
export interface DistributorOffer {
  distributorKey: DistributorKey
  distributorLabel: string
  sku: string
  price: number
  cost: number
  availability: number
  // false when this distributor genuinely doesn't carry the part — a real
  // "Not Found," not just zero stock
  found: boolean
  isMock: boolean
}

// One real-world product with every enabled distributor's offer attached —
// this is what the search results UI groups by
export interface DistributorProductGroup {
  id: string
  name: string
  manufacturer: string
  partNumber: string
  offers: DistributorOffer[]
}

export interface DistributorAdapter {
  key: DistributorKey
  label: string
  isLive: boolean
  // Whether search() accepts a free-text keyword ("monitor") vs. only an
  // exact SKU/part number (like TD Synnex)
  supportsKeywordSearch: boolean
  testConnection(
    creds: DistributorCredentials,
    sandboxMode?: boolean
  ): Promise<TestConnectionResult>
  search(
    query: string,
    creds: DistributorCredentials,
    sandboxMode?: boolean
  ): Promise<DistributorSearchResult[]>
}