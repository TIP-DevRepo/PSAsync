import type { Prisma } from "@/generated/prisma"

// What the opportunity routes return. Users are names only, never email
// addresses. expectedValue is a Decimal, which comes back as text
// ("1250.5") so no amount is rounded through a float.

const userName = { select: { id: true, name: true } } as const

export const opportunityListSelect = {
  id: true,
  number: true,
  title: true,
  source: true,
  expectedValue: true,
  expectedCloseDate: true,
  stageChangedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  owner: userName,
  team: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, category: true, winProbability: true } },
  type: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySelect

// A client location as the Client details section shows it
const clientLocationFields = {
  select: { id: true, name: true, isPrimary: true, address: true, address2: true, city: true, state: true, zip: true, country: true },
} as const

// The detail adds how many records link to it (all of them, as the delete
// block counts them), its client location, and the Client details the
// opportunity page shows: the client's main phone, its primary and main
// billing locations (for its main location when the opportunity has none,
// mainClientLocation in src/lib/client-main-location.ts), and the contact's
// title, email, work phone, and mobile. Only users who may open the
// opportunity get these, and nothing else from the client record.
export const opportunityDetailSelect = {
  ...opportunityListSelect,
  clientLocation: clientLocationFields,
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
      locations: { where: { isPrimary: true }, ...clientLocationFields, orderBy: { name: "asc" }, take: 1 },
      mainBillingLocation: clientLocationFields,
    },
  },
  contact: { select: { id: true, firstName: true, lastName: true, title: true, email: true, phone: true, mobile: true } },
  sourceTicketId: true,
  createdBy: userName,
  _count: { select: { attachments: true, quotes: true, salesOrders: true, purchaseOrders: true } },
} satisfies Prisma.OpportunitySelect

export const opportunityAttachmentSelect = {
  id: true,
  opportunityId: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  uploadedByUserId: true,
  createdAt: true,
} satisfies Prisma.OpportunityAttachmentSelect

export const opportunityStageSelect = {
  id: true,
  name: true,
  category: true,
  sortOrder: true,
  winProbability: true,
} satisfies Prisma.OpportunityStageSelect

export const opportunityTypeSelect = {
  id: true,
  name: true,
  sortOrder: true,
} satisfies Prisma.OpportunityTypeSelect

export const STAGE_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] satisfies Prisma.OpportunityStageOrderByWithRelationInput[]
export const TYPE_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] satisfies Prisma.OpportunityTypeOrderByWithRelationInput[]
