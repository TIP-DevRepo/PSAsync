import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ApprovalTriggerType } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"

// Only the Approval Workflows settings panel reads this list. Quote
// approval checks read workflows on the server themselves.
export async function GET() {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.approvalWorkflows",
    message: "You do not have permission to manage approval workflows",
  })
  if (response) return response

  const workflows = await prisma.approvalWorkflow.findMany({
    where: { companyId: ctx.companyId },
    include: { triggerUser: { select: { name: true } }, requiredRole: { select: { id: true, name: true, color: true, isGlobalAdmin: true } } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(workflows)
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess({
    permission: "settingsSections.approvalWorkflows",
    message: "You do not have permission to create approval workflows",
  })
  if (response) return response

  const body = await req.json()

  if (!body.name || !body.triggerType || !body.requiredRoleId) {
    return NextResponse.json({ error: "Name, trigger type, and required role are all required" }, { status: 400 })
  }
  if (!isEnumValue(ApprovalTriggerType, body.triggerType)) {
    return apiError(400, "Invalid trigger type")
  }
  if (body.thresholdValue != null && !Number.isFinite(Number(body.thresholdValue))) {
    return apiError(400, "Invalid threshold")
  }

  // Confirm the role and trigger user belong to this company before
  // linking a workflow to them
  const invalid = await assertRefs(ctx, { roleId: body.requiredRoleId, userId: body.triggerUserId })
  if (invalid) return invalid

  const workflow = await prisma.approvalWorkflow.create({
    data: {
      companyId: ctx.companyId,
      name: body.name,
      triggerType: body.triggerType,
      thresholdValue: body.thresholdValue != null ? Number(body.thresholdValue) : null,
      triggerUserId: body.triggerUserId || null,
      requiredRoleId: body.requiredRoleId,
      active: body.active ?? true,
    },
  })

  return NextResponse.json(workflow)
}