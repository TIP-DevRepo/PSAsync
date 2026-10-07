import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasPermission } from "@/lib/permissions"

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
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!(await hasPermission(session.user.id, "settingsSections.approvalWorkflows"))) {
    return NextResponse.json({ error: "You don't have permission to create approval workflows" }, { status: 403 })
  }

  const body = await req.json()

  if (!body.name || !body.triggerType || !body.requiredRoleId) {
    return NextResponse.json({ error: "Name, trigger type, and required role are all required" }, { status: 400 })
  }

  // Confirm the role belongs to this company before linking a workflow to it
  const role = await prisma.role.findUnique({ where: { id: body.requiredRoleId } })
  if (!role || role.companyId !== session.user.companyId) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }

  const workflow = await prisma.approvalWorkflow.create({
    data: {
      companyId: session.user.companyId,
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