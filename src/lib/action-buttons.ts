import type { NextResponse } from "next/server"
import type { Prisma, PrismaClient } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { apiError, type AccessContext } from "@/lib/api-access"
import { assertRefs, opportunityStageWhere } from "@/lib/scoped-loaders"
import { ensureOpportunityDefaults, isRefusal, type Refusal } from "@/lib/opportunity-defaults"
import { readOptionalId } from "@/lib/opportunity-rules"
import {
  AVAILABLE_ACTION_KINDS,
  toActionButtonDefinition,
  type ActionButtonDefinition,
  type ActionButtonRecordType,
  type ActionStageModeName,
} from "@/lib/timeline-buttons"
import type { OpportunityStageCategory } from "@/generated/prisma"

// Server side helpers for the admin defined action buttons (the
// ActionButton model, shared by opportunities and tickets): the starting
// buttons, the lock their writes run in, the buttons a record shows, and
// the rules a button puts on a note or email that names it.

export const ACTION_BUTTON_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] satisfies Prisma.ActionButtonOrderByWithRelationInput[]

// What the Settings screen gets for each button
export const actionButtonSelect = {
  id: true,
  label: true,
  icon: true,
  color: true,
  forOpportunities: true,
  forTickets: true,
  kind: true,
  stageMode: true,
  fixedStageId: true,
  fixedStage: { select: { id: true, name: true, category: true } },
  noteMode: true,
  isHidden: true,
  sortOrder: true,
} satisfies Prisma.ActionButtonSelect

// Today's success and danger tokens (globals.css) as hex, so Won and Lost
// keep their colors
export const WON_BUTTON_COLOR = "#3A9742"
export const LOST_BUTTON_COLOR = "#E62B34"
// The CompanySettings defaults, for a company that never set its brand
const BRAND_PRIMARY_FALLBACK = "#1B3A5C"
const BRAND_ACCENT_FALLBACK = "#2E86AB"

type Db = Pick<PrismaClient, "actionButton" | "$transaction">

// Creates the four starting buttons (Note, Email, Won, Lost, in that order)
// the first time any action button route, or a note or email naming a
// button, runs for the company. Never at company creation and never by a
// data migration. Once a company has a button it is one small read; the
// last button can't be deleted (it can be hidden), so the defaults never
// come back.
//
// Safe under concurrency the same way as ensureTeamDefaults: the
// transaction first locks the company's own row (SELECT ... FOR NO KEY
// UPDATE), so two requests run one after the other and the second finds
// the buttons the first created.
export async function ensureActionButtonDefaults(companyId: string, db: Db = prisma): Promise<void> {
  if (await db.actionButton.findFirst({ where: { companyId }, select: { id: true } })) return

  // Won and Lost point at stages
  await ensureOpportunityDefaults(companyId)

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR NO KEY UPDATE`
    if (await tx.actionButton.findFirst({ where: { companyId }, select: { id: true } })) return
    await tx.actionButton.createMany({ data: await defaultButtons(tx, companyId) })
  })
}

async function defaultButtons(tx: Prisma.TransactionClient, companyId: string): Promise<Prisma.ActionButtonCreateManyInput[]> {
  const [settings, won, lost] = await Promise.all([
    tx.companySettings.findUnique({ where: { companyId }, select: { primaryColor: true, accentColor: true } }),
    firstStageOf(tx, companyId, "WON"),
    firstStageOf(tx, companyId, "LOST"),
  ])
  const hex = (value: string | null | undefined, fallback: string) => (value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : fallback)
  // A company with no stage of a category (never true once the stage rules
  // hold) gets a button that lets the user choose instead
  const fixed = (stageId: string | null): { stageMode: ActionStageModeName; fixedStageId: string | null } =>
    stageId ? { stageMode: "FIXED", fixedStageId: stageId } : { stageMode: "CHOOSE", fixedStageId: null }

  const rows: Omit<Prisma.ActionButtonCreateManyInput, "companyId" | "sortOrder">[] = [
    {
      label: "Note",
      icon: "note",
      color: hex(settings?.primaryColor, BRAND_PRIMARY_FALLBACK),
      forOpportunities: true,
      forTickets: true,
      kind: "NOTE",
      stageMode: "CHOOSE",
      noteMode: "REQUIRED",
    },
    {
      label: "Email",
      icon: "email",
      color: hex(settings?.accentColor, BRAND_ACCENT_FALLBACK),
      forOpportunities: true,
      forTickets: true,
      kind: "EMAIL",
      stageMode: "NONE",
      noteMode: "REQUIRED",
    },
    {
      label: "Won",
      icon: "won",
      color: WON_BUTTON_COLOR,
      forOpportunities: true,
      forTickets: false,
      kind: "NOTE",
      ...fixed(won),
      noteMode: "OPTIONAL",
    },
    {
      label: "Lost",
      icon: "lost",
      color: LOST_BUTTON_COLOR,
      forOpportunities: true,
      forTickets: false,
      kind: "NOTE",
      ...fixed(lost),
      noteMode: "REQUIRED",
    },
  ]
  return rows.map((row, i) => ({ ...row, companyId, sortOrder: i }))
}

async function firstStageOf(tx: Prisma.TransactionClient, companyId: string, category: OpportunityStageCategory): Promise<string | null> {
  const stage = await tx.opportunityStage.findFirst({
    where: { companyId, category },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  })
  return stage?.id ?? null
}

class RollBack extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.error)
  }
}

// Runs fn in a transaction that first locks the company's row, so writes
// that must keep the button list consistent (never deleting the last one,
// a reorder matching the list) run one after the other. A Refusal rolls
// the transaction back, so a refused request changes nothing.
export async function withActionButtonsLock<T>(
  companyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T | Refusal>
): Promise<T | Refusal> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId} FOR NO KEY UPDATE`
      const result = await fn(tx)
      if (isRefusal(result)) throw new RollBack(result)
      return result
    })
  } catch (err) {
    if (err instanceof RollBack) return err.refusal
    throw err
  }
}

export const LAST_BUTTON_MESSAGE = "A company keeps at least one action button. Hide this one instead of deleting it."
export const BUTTON_ORDER_MESSAGE = "Invalid button order"
export const BUTTON_ORDER_STALE_MESSAGE = "The button list changed since you loaded it. Refresh and try again."
export const INVALID_RECORD_TYPE_MESSAGE = "Invalid record type"
export const INVALID_ACTION_BUTTON_MESSAGE = "Invalid action button"

// The ?for= value of GET /api/action-buttons, or null when it isn't one
export function readRecordType(value: string | null): ActionButtonRecordType | null {
  return value === "opportunity" ? value : null
}

// Where a button must be set to show for a record type
const SHOWS_ON: Record<ActionButtonRecordType, Prisma.ActionButtonWhereInput> = {
  opportunity: { forOpportunities: true },
}

// The buttons a record of this type shows, in order: not hidden, set to
// show on the record type, and of a kind whose feature exists
export function visibleButtonsWhere(companyId: string, recordType: ActionButtonRecordType): Prisma.ActionButtonWhereInput {
  return { companyId, isHidden: false, kind: { in: [...AVAILABLE_ACTION_KINDS] }, ...SHOWS_ON[recordType] }
}

export async function loadRecordButtons(companyId: string, recordType: ActionButtonRecordType): Promise<ActionButtonDefinition[]> {
  const rows = await prisma.actionButton.findMany({
    where: visibleButtonsWhere(companyId, recordType),
    orderBy: ACTION_BUTTON_ORDER,
    select: { id: true, label: true, icon: true, color: true, kind: true, stageMode: true, fixedStageId: true, noteMode: true },
  })
  return rows.map(toActionButtonDefinition).filter((b): b is ActionButtonDefinition => b !== null)
}

export function stageUsedByButtonMessage(label: string): string {
  return `The "${label}" action button moves to this stage. Change or delete that button first.`
}

// ─── Using a button ─────────────────────────────────────────────────────

export const STAGE_NOT_CHANGED_BY_BUTTON_MESSAGE = "This action doesn't change the stage"
export const FIXED_STAGE_MISMATCH_MESSAGE = "This action always moves to its own stage"

// The stage a note or email moves to under a button's stage rule, from
// the stage the request asked for (null for none):
//   NONE: no stage; asking for one is refused
//   CHOOSE: whatever the request asked for, or nothing
//   FIXED: the button's stage; asking for a different one is refused
export function buttonStageRule(
  button: { stageMode: ActionStageModeName; fixedStageId: string | null },
  requested: string | null
): { stageId: string | null; error?: undefined } | { error: string; stageId?: undefined } {
  if (button.stageMode === "NONE") return requested ? { error: STAGE_NOT_CHANGED_BY_BUTTON_MESSAGE } : { stageId: null }
  if (button.stageMode === "CHOOSE") return { stageId: requested }
  if (requested && requested !== button.fixedStageId) return { error: FIXED_STAGE_MISMATCH_MESSAGE }
  return { stageId: button.fixedStageId }
}

export interface StageRef {
  id: string
  name: string
  category: OpportunityStageCategory
}

export type ActionRequest =
  | { response: NextResponse; button?: undefined; stage?: undefined; noteRequired?: undefined }
  | { response?: undefined; button: { id: string; label: string } | null; stage: StageRef | null; noteRequired: boolean }

// Reads the actionButtonId and stageId of a note or email on an
// opportunity. Both ids go through assertRefs. A named button must be one
// the opportunity shows (not hidden, set for opportunities, an available
// kind) of the expected kind, otherwise 400 "Invalid action button"; its
// stage rule (buttonStageRule) and note rule then apply. Without a button,
// any company stage is allowed and the text is required, as before.
export async function readActionRequest(
  ctx: Pick<AccessContext, "companyId" | "userId" | "can">,
  body: Record<string, unknown>,
  kind: "NOTE" | "EMAIL"
): Promise<ActionRequest> {
  const buttonRef = readOptionalId(body.actionButtonId)
  if (buttonRef.error !== undefined) return { response: apiError(400, INVALID_ACTION_BUTTON_MESSAGE, "INVALID_REFERENCE") }
  const stageRef = readOptionalId(body.stageId)
  if (stageRef.error !== undefined) return { response: apiError(400, "Invalid stage", "INVALID_REFERENCE") }

  if (buttonRef.value) await ensureActionButtonDefaults(ctx.companyId)
  const invalid = await assertRefs(ctx, { opportunityStageId: stageRef.value, actionButtonId: buttonRef.value })
  if (invalid) return { response: invalid }

  let button: { id: string; label: string } | null = null
  let stageId = stageRef.value
  let noteRequired = true
  if (buttonRef.value) {
    const row = await prisma.actionButton.findFirst({
      where: { id: buttonRef.value, ...visibleButtonsWhere(ctx.companyId, "opportunity") },
      select: { id: true, label: true, kind: true, stageMode: true, fixedStageId: true, noteMode: true },
    })
    if (!row || row.kind !== kind) return { response: apiError(400, INVALID_ACTION_BUTTON_MESSAGE, "INVALID_REFERENCE") }
    const rule = buttonStageRule(row, stageRef.value)
    if (rule.error !== undefined) return { response: apiError(400, rule.error) }
    button = { id: row.id, label: row.label }
    stageId = rule.stageId
    noteRequired = row.noteMode === "REQUIRED"
  }

  const stage = stageId
    ? await prisma.opportunityStage.findFirst({ where: opportunityStageWhere(ctx, stageId), select: { id: true, name: true, category: true } })
    : null
  if (stageId && !stage) return { response: apiError(400, "Invalid stage", "INVALID_REFERENCE") }
  return { button, stage, noteRequired }
}
