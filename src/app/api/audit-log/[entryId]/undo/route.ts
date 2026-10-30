import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { apiError, notFound, requireAccess } from "@/lib/api-access"
import { auditEntryWhere } from "@/lib/scoped-loaders"
import { auditEntrySelect } from "@/lib/audit-log"
import { ensureOpportunityDefaults } from "@/lib/opportunity-defaults"
import { ensureTeamDefaults } from "@/lib/team-defaults"
import { undoOpportunityChange } from "@/lib/opportunity-undo"
import { userFacingError } from "@/lib/user-error"

// Undoes one field change (auditLog.restore). Only a field_changed entry
// that hasn't been undone, whose record isn't deleted, and whose field
// hasn't changed again since (undoBlockReason, the rule the lists' canUndo
// uses). The old value goes back through the opportunity PATCH rules
// (undoOpportunityChange); any refusal is a 409 with the plain reason.
// Another company's entry is a 404.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const { ctx, response } = await requireAccess({
    permission: "auditLog.restore",
    message: "You do not have permission to restore from the audit log",
  })
  if (response) return response

  const { entryId } = await params
  const entry = await prisma.auditLogEntry.findFirst({ where: auditEntryWhere(ctx, entryId), select: auditEntrySelect })
  if (!entry) return notFound()

  await ensureOpportunityDefaults(ctx.companyId)
  await ensureTeamDefaults(ctx.companyId)

  try {
    const result = await undoOpportunityChange(ctx, entry)
    if (result.status) return apiError(result.status, result.error, result.code)
    return NextResponse.json({ undone: true, opportunity: result.saved })
  } catch (err) {
    const { message, status } = userFacingError(err, "Undoing a change")
    return apiError(status, message)
  }
}
