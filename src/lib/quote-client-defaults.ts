// What a new quote takes from its client: the payment terms, and the ship
// to address from the client's main shipping location, falling back to its
// main billing location. No server imports: the New Quote form fills its
// fields with it when a contact is picked, and the copy route uses it for
// the client the copy is made for.

export interface ClientDefaultsLocation {
  address: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
}

export interface ClientDefaultsSource {
  paymentTerms: string | null
  mainShippingLocation: ClientDefaultsLocation | null
  mainBillingLocation: ClientDefaultsLocation | null
}

// Blank strings for anything the client doesn't have, as the form's inputs
// hold them
export function clientQuoteDefaults(client: ClientDefaultsSource) {
  const loc = client.mainShippingLocation ?? client.mainBillingLocation
  return {
    shipAddress: loc?.address ?? "",
    shipAddress2: loc?.address2 ?? "",
    shipCity: loc?.city ?? "",
    shipState: loc?.state ?? "",
    shipZip: loc?.zip ?? "",
    shipCountry: loc?.country ?? "",
    paymentTerms: client.paymentTerms ?? "",
  }
}

// The select that loads exactly what clientQuoteDefaults reads
const locationSelect = { address: true, address2: true, city: true, state: true, zip: true, country: true } as const
export const clientDefaultsSelect = {
  paymentTerms: true,
  mainShippingLocation: { select: locationSelect },
  mainBillingLocation: { select: locationSelect },
} as const
