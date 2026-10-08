import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"
import { ApprovalTriggerType } from "@/generated/prisma"
import { apiError, isEnumValue, requireAccess } from "@/lib/api-access"
import { assertRefs } from "@/lib/scoped-loaders"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await requireAccess()
  if (response) return response
  if (!ctx.can("settingsSections.approvalWorkflows")) {
    return NextResponse.json({ error: "You don't have permission to edit approval workflows" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.approvalWorkflow.findUnique({
    where: { id, companyId: ctx.companyId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 })
  }

  const body = await req.json()

  if (body.triggerType !== undefined && !isEnumValue(ApprovalTriggerType, body.triggerType)) {
    return apiError(400, "Invalid trigger type")
  }
  if (body.thresholdValue != null && !Number.isFinite(Number(body.thresholdValue))) {
    return apiError(400, "Invalid threshold")
  }
  const invalid = await assertRefs(ctx, { roleId: body.requiredRoleId, userId: body.triggerUserId })
  if (invalid) return invalid

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.active !== undefined) data.active = Boolean(body.active)
  if (body.triggerType !== undefined) data.triggerType = body.triggerType
  if (body.thresholdValue !== undefined) {
    data.thresholdValue = body.thresholdValue != null ? Number(body.thresholdValue) : null
  }
  if (body.triggerUserId !== undefined) data.triggerUserId = body.triggerUserId || null
  if (body.requiredRoleId !== undefined) data.requiredRoleId = body.requiredRoleId

  const workflow = await prisma.approvalWorkflow.update({ where: { id, companyId: ctx.companyId }, data })

  return NextResponse.json(workflow)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.approvalWorkflows"))) {
    return NextResponse.json({ error: "You don't have permission to delete approval workflows" }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.approvalWorkflow.findUnique({
    where: { id, companyId: session.user.companyId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 })
  }

  await prisma.approvalWorkflow.delete({ where: { id } })

  return NextResponse.json({ deleted: true })
}