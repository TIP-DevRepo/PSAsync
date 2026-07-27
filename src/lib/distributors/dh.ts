import {
  DistributorAdapter,
  DistributorCredentials,
  DistributorSearchResult,
  TestConnectionResult,
} from "./types"
import { generateMockResults } from "./mock-data"

export const dhAdapter: DistributorAdapter = {
  key: "DH",
  label: "D&H",
  isLive: false,
  supportsKeywordSearch: true,

  async testConnection(creds: DistributorCredentials): Promise<TestConnectionResult> {
    // TODO once approved: D&H REST API call using apiKey to confirm access
    // (apply for access via the D&H partner portal first).
    return {
      success: false,
      status: "D&H adapter is built but not live yet — waiting on API account approval.",
    }
  },

  async search(query: string, _creds: DistributorCredentials): Promise<DistributorSearchResult[]> {
    // TODO once approved: call D&H's product search endpoint with apiKey,
    // then map the response into DistributorSearchResult objects.
    return generateMockResults(query, "DH")
  },
}