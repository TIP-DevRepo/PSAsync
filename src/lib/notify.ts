import { PrismaClient } from "@/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { sendQuoteNotificationEmail, sendCompanyNotificationEmail } from "@/lib/send-quote-email"

const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

type NotifyEvent = "QUOTE_VIEWED" | "QUOTE_APPROVED" | "QUOTE_LOST"

const EVENT_COPY: Record<NotifyEvent, { verb: string; subjectVerb: string }> = {
  QUOTE_VIEWED: { verb: "viewed", subjectVerb: "was viewed" },
  QUOTE_APPROVED: { verb: "approved", subjectVerb: "was approved" },
  QUOTE_LOST: { verb: "declined", subjectVerb: "was declined" },
}

// Notifies the quote's assigned rep that a client posted a comment on the
// portal. Separate from notifyQuoteEvent since the message wording and
// email body need the actual comment text, not just a status verb.
export async function notifyQuoteComment(quoteId: string, authorName: string, message: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!quote) return

  const displayNumber = quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber
  const notifMessage = `${authorName} sent a message on quote ${displayNumber}`
  const link = `/dashboard/quotes/${quoteId}`

  await prisma.notification.create({
    data: {
      companyId: quote.companyId,
      userId: quote.userId,
      type: "QUOTE_COMMENT",
      message: notifMessage,
      link,
    },
  })

  try {
    await sendQuoteNotificationEmail(
      quoteId,
      quote.user.email,
      `New message on Quote ${displayNumber} from ${authorName}`,
      `<p>Hi ${quote.user.name},</p><p>${authorName} sent a message on Quote ${displayNumber}:</p><blockquote>${message.replace(/\n/g, "<br/>")}</blockquote><p><a href="${process.env.NEXTAUTH_URL ?? ""}${link}">View and reply</a></p>`
    )
  } catch (err) {
    console.error("Failed to send comment notification email:", err)
  }
}

// Fires an in-app notification and an email to the quote's assigned rep.
// Called from the portal view/accept/decline routes whenever a client
// takes one of those actions. Email failures are logged, not thrown — a
// client accepting or declining a quote should never fail because a
// notification email couldn't send.
export async function notifyQuoteEvent(quoteId: string, event: NotifyEvent) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      client: { select: { name: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  })
  if (!quote) return

  const displayNumber = quote.version > 1 ? `${quote.quoteNumber} v${quote.version}` : quote.quoteNumber
  const { verb, subjectVerb } = EVENT_COPY[event]
  const message = `${quote.client.name} ${verb} quote ${displayNumber}`
  const link = `/dashboard/quotes/${quoteId}`

  await prisma.notification.create({
    data: {
      companyId: quote.companyId,
      userId: quote.userId,
      type: event,
      message,
      link,
    },
  })

  try {
    await sendQuoteNotificationEmail(
      quoteId,
      quote.user.email,
      `Quote ${displayNumber} ${subjectVerb}`,
      `<p>Hi ${quote.user.name},</p><p>${message}.</p><p><a href="${process.env.NEXTAUTH_URL ?? ""}${link}">View the quote</a></p>`
    )
  } catch (err) {
    console.error("Failed to send notification email:", err)
  }
}

interface SOStatusNotifyRule {
  type: "user" | "role"
  id: string
}

const SO_STATUS_TO_NOTIFICATION_TYPE: Record<string, "SO_READY_TO_INVOICE" | "SO_READY_TO_ORDER" | "SO_READY_TO_CLOSEOUT"> = {
  READY_TO_INVOICE: "SO_READY_TO_INVOICE",
  READY_TO_ORDER: "SO_READY_TO_ORDER",
  READY_TO_CLOSEOUT: "SO_READY_TO_CLOSEOUT",
}

function soStatusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
}

// Notifies whoever is configured (a specific user, or every active user
// holding a specific role) in CompanySettings.soStatusNotifyRules for the
// given status. No-ops silently if nothing is configured for that status.
export async function notifySalesOrderStatusChange(salesOrderId: string, status: string) {
  const notificationType = SO_STATUS_TO_NOTIFICATION_TYPE[status]
  if (!notificationType) return

  const salesOrder = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      client: { select: { name: true } },
      company: { select: { settings: true } },
    },
  })
  if (!salesOrder) return

  const rules = salesOrder.company.settings?.soStatusNotifyRules as
    | Record<string, SOStatusNotifyRule | null>
    | undefined
  const rule = rules?.[status]
  if (!rule) return

  // A role rule matches every active user holding that role among any of
  // their roles. The Everyone role is held implicitly by every user in the
  // company, so it matches all of them.
  let recipientUserIds: string[]
  if (rule.type === "user") {
    recipientUserIds = [rule.id]
  } else {
    const role = await prisma.role.findUnique({
      where: { id: rule.id },
      select: { companyId: true, isEveryone: true },
    })
    if (!role || role.companyId !== salesOrder.companyId) return
    const users = await prisma.user.findMany({
      where: role.isEveryone
        ? { companyId: salesOrder.companyId, active: true }
        : { active: true, userRoles: { some: { roleId: rule.id } } },
      select: { id: true },
    })
    recipientUserIds = users.map((u) => u.id)
  }

  const label = soStatusLabel(status)
  const message = `${salesOrder.soNumber} (${salesOrder.client.name}) is ${label}`
  const link = `/dashboard/sales-orders/${salesOrderId}`

  for (const userId of recipientUserIds) {
    await prisma.notification.create({
      data: { companyId: salesOrder.companyId, userId, type: notificationType, message, link },
    })

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
    if (!user?.email) continue

    try {
      await sendCompanyNotificationEmail(
        salesOrder.companyId,
        user.email,
        `${salesOrder.soNumber} — ${label}`,
        `<p>Hi ${user.name},</p><p>${message}.</p><p><a href="${process.env.NEXTAUTH_URL ?? ""}${link}">View the Sales Order</a></p>`,
        userId
      )
    } catch (err) {
      console.error("Failed to send SO status notification email:", err)
    }
  }
}