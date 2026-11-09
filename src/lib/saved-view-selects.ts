import type { Prisma } from "@/generated/prisma"

// What the saved view routes return, and their order
export const savedViewSelect = { id: true, page: true, name: true, params: true, sortOrder: true } satisfies Prisma.SavedViewSelect
export const SAVED_VIEW_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] satisfies Prisma.SavedViewOrderByWithRelationInput[]
