"use client"

import { useState } from "react"
import { Modal } from "@/components/Modal"
import { Button } from "@/components/ui/button"
import { ContactSearchInput, type ContactSearchResult } from "@/components/ContactSearchInput"
import { formatPhoneInput } from "@/lib/phone"
import { toast } from "@/lib/toast"
import { OpportunityPicker } from "@/components/opportunities/OpportunityPicker"

// Copying a quote takes only its details and items, so the rep picks who
// the copy is for with the same contact picker as the New Quote form (the
// contact brings its client). Nothing is created until a contact is chosen
// and Create Copy is pressed; Cancel creates nothing. The copy never takes
// the original's opportunity; the rep may pick one for the copy's client
// and contact.
export function CopyQuoteModal({
  quote,
  onClose,
  onCopied,
}: {
  quote: { id: string; quoteNumber: string }
  onClose: () => void
  onCopied: (newQuoteId: string) => void
}) {
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null)
  const [opportunityId, setOpportunityId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function chooseContact(contact: ContactSearchResult) {
    setSelectedContact(contact)
    // An opportunity belongs to one client and contact
    setOpportunityId(null)
  }

  async function handleCopy() {
    if (!selectedContact) return
    setSaving(true)
    const res = await fetch(`/api/quotes/${quote.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: selectedContact.client.id, contactId: selectedContact.id, opportunityId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || typeof data.id !== "string") {
      setSaving(false)
      toast.error("Couldn't copy this quote", data.error)
      return
    }
    onCopied(data.id)
  }

  return (
    <Modal maxWidth="md" onClose={saving ? undefined : onClose}>
      <h2 className="text-lg font-bold text-foreground">Copy {quote.quoteNumber}</h2>
      <p className="text-sm text-muted-foreground">
        The copy keeps this quote&apos;s title, intro, terms, sections, and line items. Choose the client and
        contact the copy is for. Its payment terms and shipping address come from that client.
      </p>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground">
          Client and contact <span className="text-danger">*</span>
        </label>
        <ContactSearchInput onSelect={chooseContact} />
        {selectedContact ? (
          <div className="rounded-md border border-border p-3 text-sm space-y-0.5 bg-surface-hover">
            <p className="font-medium text-foreground">
              {selectedContact.firstName} {selectedContact.lastName}
              {selectedContact.title && <span className="text-muted-foreground">, {selectedContact.title}</span>}
            </p>
            <p className="text-muted-foreground">{selectedContact.client.name}</p>
            {selectedContact.email && <p className="text-muted-foreground">{selectedContact.email}</p>}
            {selectedContact.phone && <p className="text-muted-foreground">{formatPhoneInput(selectedContact.phone)}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Search for a contact. Their company becomes the copy&apos;s client.</p>
        )}
      </div>

      <OpportunityPicker
        record="quote"
        clientId={selectedContact?.client.id ?? null}
        contactId={selectedContact?.id ?? null}
        value={opportunityId}
        onChange={setOpportunityId}
        id="copy-opportunity-picker"
      />

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleCopy} disabled={!selectedContact || saving}>
          {saving ? "Copying..." : "Create Copy"}
        </Button>
      </div>
    </Modal>
  )
}
