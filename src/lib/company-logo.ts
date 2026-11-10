// The company logo rules every place a logo is shown shares, and the rule
// for removing one. No React and no database imports, so the portal page
// (a client component), the quote PDF template, and the logo route all use
// the same code, and each rule can be checked on its own.
//
// Where a company logo shows, and what shows without one:
//   the staff app (sidebar, phone menu): the primary logo on a white tile,
//     else the PSAsync mark, white artwork on an accent tile (PsasyncMark,
//     LogoTile in src/components/layout/sidebar.tsx)
//   customer facing places: the portal page and its expired link page show
//     the secondary logo, else the primary; every quote PDF (staff, portal,
//     and the one attached to a quote email) shows the primary logo, as it
//     always has. Each shows the logo next to the company name, and with no
//     logo the company name alone as a wordmark in the logo spot, never the
//     PSAsync logo. Quote and notification emails carry no logo in their
//     body.
//   Settings > Company Info & Branding: each slot's logo, else an empty
//     state with the PSAsync mark and "No logo uploaded"

export type LogoSlot = "primary" | "secondary"

export function isLogoSlot(value: unknown): value is LogoSlot {
  return value === "primary" || value === "secondary"
}

// Only a web link reaches an img tag or the PDF; anything else counts as
// no logo
export function usableLogoUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null
}

// What a customer sees in the logo spot: the secondary logo (made for
// customer facing headers) when given, else the primary, else the company
// name as text
export type CustomerBrandMark = { kind: "logo"; src: string; name: string } | { kind: "name"; name: string }

export function customerBrandMark(company: { name: string; logoUrl: string | null; secondaryLogoUrl?: string | null }): CustomerBrandMark {
  const src = usableLogoUrl(company.secondaryLogoUrl) ?? usableLogoUrl(company.logoUrl)
  return src ? { kind: "logo", src, name: company.name } : { kind: "name", name: company.name }
}

// The stored file a logo removal may delete: the slot's file, unless the
// other slot still shows the same file (the upload route keeps it then too)
export function logoFileToDelete(before: { logoUrl: string | null; secondaryLogoUrl: string | null }, slot: LogoSlot): string | null {
  const removed = slot === "secondary" ? before.secondaryLogoUrl : before.logoUrl
  const other = slot === "secondary" ? before.logoUrl : before.secondaryLogoUrl
  return removed && removed !== other ? removed : null
}
