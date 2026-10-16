import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAccess } from "@/lib/api-access"

export async function GET(req: NextRequest) {
  // Open to any active user: the contact pickers on quote and order forms
  // search here
  const { ctx, response } = await requireAccess()
  if (response) return response

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 2) {
    return NextResponse.json([])
  }

  const contacts = await prisma.contact.findMany({
    where: {
      client: { companyId: ctx.companyId },
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
            paymentTerms: true,
            mainBillingLocation: {
            select: { name: true, address: true, address2: true, city: true, state: true, zip: true, country: true },
          },
          mainShippingLocation: {
            select: { name: true, address: true, address2: true, city: true, state: true, zip: true, country: true },
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