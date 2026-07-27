import { DistributorKey, DistributorSearchResult, DistributorOffer } from "./types"

const SAMPLE_PRODUCTS = [
  { name: "Dell Latitude 5450 Laptop", manufacturer: "Dell" },
  { name: "Cisco Catalyst 9200 Switch (24-port)", manufacturer: "Cisco" },
  { name: "HP LaserJet Pro M404dn Printer", manufacturer: "HP" },
  { name: "Ubiquiti UniFi Access Point U6-Pro", manufacturer: "Ubiquiti" },
  { name: "Synology DS923+ NAS (4-Bay)", manufacturer: "Synology" },
  { name: "Microsoft Surface Pro 10", manufacturer: "Microsoft" },
  { name: "APC Smart-UPS 1500VA", manufacturer: "APC" },
]

function seededNumber(seed: string, min: number, max: number) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return min + (hash % (max - min))
}

// Used only when NO live keyword-capable distributor is enabled at all —
// generates standalone mock "products" from scratch so search still
// returns something.
export function generateMockResults(
  query: string,
  distributor: DistributorKey
): DistributorSearchResult[] {
  const matches = SAMPLE_PRODUCTS.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) || query.trim() === ""
  ).slice(0, 3)

  const pool = matches.length > 0 ? matches : SAMPLE_PRODUCTS.slice(0, 2)

  return pool.map((p, i) => {
    const msrp = Math.round((150 + Math.random() * 1200) * 100) / 100
    const cost = Math.round(msrp * (0.65 + Math.random() * 0.15) * 100) / 100
    return {
      name: p.name,
      manufacturer: p.manufacturer,
      partNumber: `${distributor.slice(0, 3)}-${1000 + i}`,
      sku: `SKU-${Math.floor(10000 + Math.random() * 90000)}`,
      msrp,
      cost,
      stock: Math.floor(Math.random() * 250),
      leadTime: Math.random() > 0.5 ? "In Stock" : "3-5 business days",
      distributor,
      isMock: true,
    }
  })
}

// Used to attach a mock price/stock offer from a still-mock distributor
// (D&H, Amazon Business) onto a REAL product a live distributor found —
// seeded by the product's part number, so the same product always shows
// the same mock price/stock instead of changing on every search.
export function generateMockOffer(
  partNumber: string,
  distributor: DistributorKey
): Omit<DistributorOffer, "distributorLabel"> {
  const seed = `${partNumber}-${distributor}`
  const price = seededNumber(seed, 2000, 50000) / 100
  const cost = Math.round(price * 0.78 * 100) / 100
  return {
    distributorKey: distributor,
    sku: `${distributor.slice(0, 3)}-${seededNumber(seed + "-sku", 10000, 99999)}`,
    price,
    cost,
    availability: seededNumber(seed + "-avail", 0, 250),
    found: true,
    isMock: true,
  }
}