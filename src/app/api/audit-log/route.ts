import { NextRequest } from "next/server"
import { requireAccess } from "@/lib/api-access"
import { auditListResponse } from "@/lib/audit-records"

// The company's audit log (Settings > Audit Log), newest first,
// AUDIT_PAGE_SIZE (50) at a time with ?cursor= (the last entry of the
// previous page). Filtered on the server (readAuditFilters): recordType,
// action, actor, record, field, from, and to. Each entry says whether its
// record is deleted and whether this user may undo or restore from it; the
// first page also lists the record types the company has entries for.
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "auditLog.view",
    message: "You do not have permission to view the audit log",
  })
  if (response) return response

  return auditListResponse(ctx, req.nextUrl.searchParams, {}, { withRecordTypes: true })
}
