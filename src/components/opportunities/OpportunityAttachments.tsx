"use client"

import { RecordAttachments } from "@/components/attachments/RecordAttachments"

// An opportunity's Attachments tab: the shared record attachments panel on
// its attachments route, Remove only with opportunities.edit
export function OpportunityAttachments({ opportunityId, canEdit, onChanged }: { opportunityId: string; canEdit: boolean; onChanged?: () => void }) {
  return <RecordAttachments attachmentsUrl={`/api/opportunities/${opportunityId}/attachments`} recordNoun="opportunity" canEdit={canEdit} onChanged={onChanged} />
}
