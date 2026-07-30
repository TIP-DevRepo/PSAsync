import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 2) {
    return NextResponse.json([])
  }

  const contacts = await prisma.contact.findMany({
    where: {
      client: { companyId: session.user.companyId },
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { client: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          mainBillingLocation: {
            select: { name: true, address: true, city: true, state: true, zip: true },
          },
          mainShippingLocation: {
            select: { name: true, address: true, city: true, state: true, zip: true },
          },
        },
      },
    },
    take: 8,
    orderBy: { firstName: "asc" },
  })

  const result = contacts.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    title: c.title,
    email: c.email,
    phone: c.phone,
    client: c.client,
  }))

  return NextResponse.json(result)
}