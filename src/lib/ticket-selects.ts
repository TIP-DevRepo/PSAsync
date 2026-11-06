import type { Prisma } from "@/generated/prisma"

// What the ticket routes return. Users are names only, never email
// addresses.

const userName = { select: { id: true, name: true } } as const

export const ticketListSelect = {
  id: true,
  number: true,
  title: true,
  source: true,
  statusChangedAt: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  team: { select: { id: true, name: true } },
  assignee: userName,
  type: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true, sortOrder: true } },
  status: { select: { id: true, name: true, category: true } },
} satisfies Prisma.TicketSelect

const clientLocationFields = {
  select: { id: true, name: true, address: true, address2: true, city: true, state: true, zip: true, country: true },
} as const

// The detail adds the location, the client's main phone, the contact's
// title, email, work phone, and mobile, who created it, and how many
// attachments it has. Only users who may open the ticket get these.
export const ticketDetailSelect = {
  ...ticketListSelect,
  clientLocation: clientLocationFields,
  client: { select: { id: true, name: true, phone: true } },
  contact: { select: { id: true, firstName: true, lastName: true, title: true, email: true, phone: true, mobile: true } },
  createdBy: userName,
  _count: { select: { attachments: true } },
} satisfies Prisma.TicketSelect

export const ticketAttachmentSelect = {
  id: true,
  ticketId: true,
  fileName: true,
  fileUrl: true,
  fileSize: true,
  uploadedByUserId: true,
  createdAt: true,
} satisfies Prisma.TicketAttachmentSelect

export const ticketTypeSelect = { id: true, name: true, sortOrder: true } satisfies Prisma.TicketTypeSelect
export const ticketPrioritySelect = { id: true, name: true, sortOrder: true } satisfies Prisma.TicketPrioritySelect
export const ticketStatusSelect = { id: true, name: true, category: true, sortOrder: true } satisfies Prisma.TicketStatusSelect

export const SORTED = [{ sortOrder: "asc" }, { createdAt: "asc" }] as const
export const TICKET_TYPE_ORDER = [...SORTED] satisfies Prisma.TicketTypeOrderByWithRelationInput[]
export const TICKET_PRIORITY_ORDER = [...SORTED] satisfies Prisma.TicketPriorityOrderByWithRelationInput[]
export const TICKET_STATUS_ORDER = [...SORTED] satisfies Prisma.TicketStatusOrderByWithRelationInput[]

export const ticketSettingsSelect = {
  prefix: true,
  defaultTeamId: true,
  defaultTeam: { select: { id: true, name: true } },
  autoCloseResolvedDays: true,
} satisfies Prisma.TicketSettingsSelect
