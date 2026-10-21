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
  stage: { select: { id: true, name: true, category: true, winProbability: true } },
  type: { select: { id: true, name: true } },
} satisfies Prisma.OpportunitySelect

// The detail adds the long fields and how many records link to it (all of
// them, as the delete block counts them)
export const opportunityDetailSelect = {
  ...opportunityListSelect,
  notes: true,
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
