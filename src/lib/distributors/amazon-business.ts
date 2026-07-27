import {
  DistributorAdapter,
  DistributorCredentials,
  DistributorSearchResult,
  TestConnectionResult,
} from "./types"
import { generateMockResults } from "./mock-data"

export const amazonBusinessAdapter: DistributorAdapter = {
  key: "AMAZON_BUSINESS",
  label: "Amazon Business",
  isLive: false,
  supportsKeywordSearch: true,

  async testConnection(creds: DistributorCredentials): Promise<TestConnectionResult> {
    // TODO once approved: Login with Amazon (LWA) OAuth using clientId + clientSecret
    // to get an access token, then a lightweight Selling Partner API call to confirm it works.
    return {
      success: false,
      status: "Amazon Business adapter is built but not live yet — waiting on API account approval.",
    }
  },

  async search(query: string, _creds: DistributorCredentials): Promise<DistributorSearchResult[]> {
    // TODO once approved: call the Amazon Business/Selling Partner API catalog search
    // endpoint with the LWA access token, then map results into DistributorSearchResult objects.
    return generateMockResults(query, "AMAZON_BUSINESS")
  },
}