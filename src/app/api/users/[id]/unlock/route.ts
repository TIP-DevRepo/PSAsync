import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getEffectiveAccess } from "@/lib/permissions"

// Clears a user's login lockout so they can sign in again right away.
// Global Admin only, even for someone with Manage Users access, and only
// for users in the same company. The password change lockout on My Account
// is a separate counter and is left as it is.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const access = await getEffectiveAccess(session.user.id)
  if (!access?.isGlobalAdmin) {
    return NextResponse.json({ error: "Only a Global Admin can unlock users" }, { status: 403 })
  }

  const { id } = await params
  const { count } = await prisma.user.updateMany({
    where: { id, companyId: session.user.companyId },
    data: { loginFailedAttempts: 0, loginLockedUntil: null },
  })
  if (count === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
