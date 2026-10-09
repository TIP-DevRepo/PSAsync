import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { ApprovalTriggerType } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const workflows = await prisma.approvalWorkflow.findMany({
    where: { companyId: session.user.companyId },
    include: { triggerUser: { select: { name: true } }, requiredRole: { select: { id: true, name: true, color: true, isGlobalAdmin: true } } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(workflows)
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAccess()
  if (response) return response
  if (!ctx.can("settingsSections.approvalWorkflows")) {
    return NextResponse.json({ error: "You don't have permission to create approval workflows" }, { status: 403 })
  }

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