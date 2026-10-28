import { prisma } from "@/lib/prisma"
import type { AccessContext } from "@/lib/api-access"

// Which connected Microsoft mailbox a quote email goes out from. Never
// carries tokens, only what the Send Quote dialog and the audit note need.
export interface SenderMailbox {
  id: string
  email: string
  label: string
  connectedByUserId: string | null
  ownerName: string | null
}

export type SenderDecision =
  | { ok: true; mailbox: SenderMailbox; isShared: boolean }
  | { ok: false; status: 400 | 403; error: string; code?: string }

export interface SenderInput {
  // Quote Settings is set to send every quote from one shared mailbox
  sharedMode: boolean
  // That shared mailbox, when it is still connected in this company
  shared: SenderMailbox | null
  // The quote owner's and the clicking user's own mailboxes, if connected
  owner: SenderMailbox | null
  clicker: SenderMailbox | null
  isOwner: boolean
  canSendAsOthers: boolean
  // A mailbox picked in the dialog, looked up within this company only
  requestedId?: string | null
  requested?: SenderMailbox | null
  // What to say when the sender has no mailbox of their own; quotes by
  // default
  connectMessage?: string
}

const CONNECT_YOURS =
  "Connect your mailbox in Settings > Microsoft Integration before sending quotes."

// The pure sender rules, kept apart from the database so they can be
// tested on their own:
// - Shared mode: the shared mailbox is the default for everyone.
// - Creator mode: the quote owner's mailbox when the clicker is the owner
//   or holds quotes.sendAsOthers, otherwise the clicker's own mailbox, so a
//   colleague's mailbox is never used without that permission.
// - A picked mailbox needs quotes.sendAsOthers and must be in this company.
// A missing mailbox is an error, never a fallback to someone else's.
export function chooseQuoteSender(input: SenderInput): SenderDecision {
  const isShared = (m: SenderMailbox) => input.sharedMode && !!input.shared && m.id === input.shared.id
  const connectYours = input.connectMessage ?? CONNECT_YOURS

  if (input.requestedId) {
    if (!input.canSendAsOthers) {
      return { ok: false, status: 403, error: "You do not have permission to send as another mailbox", code: "FORBIDDEN" }
    }
    if (!input.requested || input.requested.id !== input.requestedId) {
      return { ok: false, status: 400, error: "Invalid mailbox", code: "INVALID_REFERENCE" }
    }
    return { ok: true, mailbox: input.requested, isShared: isShared(input.requested) }
  }

  if (input.sharedMode) {
    if (!input.shared) {
      return {
        ok: false,
        status: 400,
        error: "The shared mailbox set in Quote Settings is no longer connected. Ask an admin to reconnect it.",
      }
    }
    return { ok: true, mailbox: input.shared, isShared: true }
  }

  if (input.isOwner || input.canSendAsOthers) {
    if (!input.owner) {
      return {
        ok: false,
        status: 400,
        error: input.isOwner
          ? connectYours
          : "The quote owner hasn't connected a mailbox yet. Ask them to connect it in Settings > Microsoft Integration, or choose another mailbox.",
      }
    }
    return { ok: true, mailbox: input.owner, isShared: false }
  }

  if (!input.clicker) {
    return { ok: false, status: 400, error: connectYours }
  }
  return { ok: true, mailbox: input.clicker, isShared: false }
}

// The audit line for a send from a mailbox that belongs to someone other
// than the user who clicked Send, or null when it is their own
export function sendAsNote(clicker: { userId: string; name: string }, mailbox: SenderMailbox): string | null {
  if (mailbox.connectedByUserId === clicker.userId) return null
  const as = mailbox.ownerName ? `${mailbox.ownerName} (${mailbox.email})` : mailbox.email
  return `[Sent by ${clicker.name} as ${as}]`
}

// The note added to the top of the quote's internal notes, the same place
// an approval rejection is recorded
export function withNote(internalNotes: string | null, note: string | null): string | null | undefined {
  if (!note) return undefined
  return internalNotes ? `${note}\n\n${internalNotes}` : note
}

const mailboxSelect = {
  id: true,
  email: true,
  label: true,
  connectedByUserId: true,
  connectedByUser: { select: { name: true } },
} as const

type MailboxRow = {
  id: string
  email: string
  label: string
  connectedByUserId: string | null
  connectedByUser: { name: string } | null
}

function toMailbox(row: MailboxRow | null): SenderMailbox | null {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    connectedByUserId: row.connectedByUserId,
    ownerName: row.connectedByUser?.name ?? null,
  }
}

// A user's own mailbox. Someone with several gets their first connected.
function loadUserMailbox(companyId: string, userId: string) {
  return prisma.microsoftConnection
    .findFirst({
      where: { companyId, connectedByUserId: userId },
      select: mailboxSelect,
      orderBy: { createdAt: "asc" },
    })
    .then(toMailbox)
}

// Any mailbox, only when it belongs to this company
export function loadCompanyMailbox(companyId: string, connectionId: string) {
  return prisma.microsoftConnection
    .findFirst({ where: { id: connectionId, companyId }, select: mailboxSelect })
    .then(toMailbox)
}

export function listCompanyMailboxes(companyId: string) {
  return prisma.microsoftConnection
    .findMany({ where: { companyId }, select: mailboxSelect, orderBy: { createdAt: "asc" } })
    .then((rows) => rows.map((r) => toMailbox(r) as SenderMailbox))
}

type SenderCaller = Pick<AccessContext, "companyId" | "userId" | "can">

// Loads what chooseQuoteSender needs for one quote and one caller
export async function loadSenderInput(
  ctx: SenderCaller,
  quote: { userId: string },
  requestedId?: string | null
): Promise<SenderInput & { sharedId: string | null }> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId: ctx.companyId },
    select: { quoteSendFromMode: true, quoteSendFromConnectionId: true },
  })
  const sharedId =
    settings?.quoteSendFromMode === "SPECIFIC" && settings.quoteSendFromConnectionId
      ? settings.quoteSendFromConnectionId
      : null
  const isOwner = quote.userId === ctx.userId

  const [shared, owner, clicker, requested] = await Promise.all([
    sharedId ? loadCompanyMailbox(ctx.companyId, sharedId) : null,
    loadUserMailbox(ctx.companyId, quote.userId),
    isOwner ? null : loadUserMailbox(ctx.companyId, ctx.userId),
    requestedId ? loadCompanyMailbox(ctx.companyId, requestedId) : null,
  ])

  return {
    sharedMode: !!sharedId,
    sharedId,
    shared,
    owner,
    clicker: isOwner ? owner : clicker,
    isOwner,
    canSendAsOthers: ctx.can("quotes.sendAsOthers"),
    requestedId: requestedId || null,
    requested,
  }
}

export async function resolveQuoteSender(ctx: SenderCaller, quote: { userId: string }, requestedId?: string | null) {
  return chooseQuoteSender(await loadSenderInput(ctx, quote, requestedId))
}

// The From choices a send dialog shows: the default sender (or why there
// is none), whether the user may pick another mailbox (quotes.sendAsOthers),
// and the mailboxes they may pick from. Someone without the permission only
// ever gets their default sender back. Never returns tokens or any other
// credential.
export async function senderOptionsFor(ctx: SenderCaller, owner: { userId: string }, connectMessage?: string) {
  const input = await loadSenderInput(ctx, owner)
  const decision = chooseQuoteSender({ ...input, connectMessage })
  const canChooseSender = input.canSendAsOthers

  const toOption = (m: SenderMailbox) => ({
    connectionId: m.id,
    email: m.email,
    ownerName: m.ownerName,
    isShared: m.id === input.sharedId,
  })

  const options = canChooseSender
    ? (await listCompanyMailboxes(ctx.companyId)).map(toOption)
    : decision.ok
      ? [toOption(decision.mailbox)]
      : []

  return {
    defaultConnectionId: decision.ok ? decision.mailbox.id : null,
    // Why there is no default, e.g. the user still has to connect a mailbox
    defaultError: decision.ok ? null : decision.error,
    canChooseSender,
    options,
  }
}

// Email sent from a record with no owner rule of its own (an opportunity
// now, a ticket later) uses Send Quote's rule with the sender as the owner:
// the shared mailbox when Quote Settings names one, otherwise the user's
// own, and another mailbox only with quotes.sendAsOthers
export const CONNECT_YOURS_FOR_EMAIL = "Connect your mailbox in Settings > Microsoft Integration to send email."

export async function resolveOwnSender(ctx: SenderCaller, requestedId?: string | null) {
  const input = await loadSenderInput(ctx, { userId: ctx.userId }, requestedId)
  return chooseQuoteSender({ ...input, connectMessage: CONNECT_YOURS_FOR_EMAIL })
}

export function ownSenderOptions(ctx: SenderCaller) {
  return senderOptionsFor(ctx, { userId: ctx.userId }, CONNECT_YOURS_FOR_EMAIL)
}

// The name the audit note uses for whoever clicked Send
export async function actorName(ctx: Pick<AccessContext, "userId" | "userName">): Promise<string> {
  if (ctx.userName) return ctx.userName
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } })
  return user?.email ?? "a team member"
}

// Recipient limit for one quote email, To and CC together
export const MAX_RECIPIENTS = 25
const EMAIL_PATTERN = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/

// A comma separated recipient list from the Send Quote dialog, trimmed and
// checked. Returns the cleaned list, or an error naming the bad address.
export function parseRecipients(
  value: unknown
): { list: string[]; error?: undefined } | { error: string; list?: undefined } {
  if (value === undefined || value === null || value === "") return { list: [] }
  if (typeof value !== "string") return { error: "Recipients must be a list of email addresses" }
  const list = value
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
  const bad = list.find((e) => e.length > 254 || !EMAIL_PATTERN.test(e))
  if (bad) return { error: `"${bad}" is not a valid email address` }
  return { list }
}
