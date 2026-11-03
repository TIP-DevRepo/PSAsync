"use client"

import { AuditLogTable } from "@/components/audit/AuditLogTable"

// Settings > Audit Log (auditLog.view): every change recorded for the
// company, newest first, kept forever. Undo and Restore show for users with
// auditLog.restore where the server allows them.
export function AuditLogSettingsPanel() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every change to your records, who made it, and when. Opportunities are recorded today. A field change can be undone while that field hasn&apos;t
        changed again, and a deleted opportunity can be restored.
      </p>
      <AuditLogTable listUrl="/api/audit-log" showTypeFilter showRecordColumn filterRowId="audit-log-column-filters" />
    </div>
  )
}
