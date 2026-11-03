import { prisma } from "@/lib/prisma"

// Sending email through a connected Microsoft mailbox with Graph, shared by
// Send Quote (src/lib/send-quote-email.ts), the company notification
// emails, and the Email action on records (an opportunity now, a ticket
// later). Refreshes the mailbox's access token, saves the new tokens, and
// posts one sendMail call. Never logs addresses, bodies, or tokens.

export const MAIL_SCOPES = "openid profile email offline_access User.Read Mail.Send Mail.ReadWrite Calendars.ReadWrite"

// Graph sends a JSON sendMail body of at most 4 MB, and attachments grow by
// a third as base64, so files attached to one email are kept to 3 MB in all
export const EMAIL_ATTACHMENTS_MAX_BYTES = 3 * 1024 * 1024

// The company's Microsoft app registration (CompanySettings)
export interface MicrosoftApp {
  microsoftTenantId: string
  microsoftClientId: string
  microsoftClientSecret: string
}

export interface MailboxResult {
  success: boolean
  error?: string
}

// A failed Graph call for the server log: the status and Graph's error
// code only. The message can name the recipients' addresses.
export async function graphErrorSummary(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null
  const code = typeof body?.error?.code === "string" ? ` ${body.error.code}` : ""
  return `${res.status}${code}`
}

// Graph recipients from a comma separated list or an array of addresses
export function graphRecipients(list: string | readonly string[]) {
  return (typeof list === "string" ? list.split(",") : [...list])
    .map((e) => e.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }))
}

// Refreshes the mailbox's access token before using it (simpler and more
// reliable than tracking expiry) and saves the new tokens. Returns the
// access token, or null when Microsoft refused, so the caller can say the
// mailbox may need reconnecting.
export async function refreshMailboxAccess(app: MicrosoftApp, connection: { id: string; refreshToken: string }): Promise<string | null> {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${app.microsoftTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.microsoftClientId,
      client_secret: app.microsoftClientSecret,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
      scope: MAIL_SCOPES,
    }),
  })
  if (!tokenRes.ok) return null
  const tokens = await tokenRes.json()

  await prisma.microsoftConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || connection.refreshToken,
    },
  })
  return tokens.access_token as string
}

// Posts one message with Graph's sendMail, saved to the mailbox's Sent
// Items. True when Microsoft accepted it; a refusal logs one line with the
// status and Graph's error code.
export async function postSendMail(accessToken: string, message: Record<string, unknown>): Promise<boolean> {
  const sendRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  })
  if (!sendRes.ok) {
    console.error(`Microsoft Graph sendMail failed: ${await graphErrorSummary(sendRes)}`)
    return false
  }
  return true
}

export interface OutgoingEmail {
  subject: string
  bodyHtml: string
  to: readonly string[]
  cc: readonly string[]
  bcc: readonly string[]
  attachments: readonly { name: string; contentType: string; bytes: Uint8Array }[]
}

// Sends an email from one connected mailbox of the company (already chosen
// by the sender rules in src/lib/quote-sender.ts). A mailbox that has gone,
// missing app credentials, a refused token refresh, and a refused send all
// come back as a plain error, never thrown.
export async function sendFromMailbox(companyId: string, connectionId: string, email: OutgoingEmail): Promise<MailboxResult> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { microsoftTenantId: true, microsoftClientId: true, microsoftClientSecret: true },
  })
  if (!settings?.microsoftClientId || !settings.microsoftTenantId || !settings.microsoftClientSecret) {
    return { success: false, error: "Microsoft integration isn't configured for this company." }
  }
  const connection = await prisma.microsoftConnection.findFirst({
    where: { id: connectionId, companyId },
    select: { id: true, refreshToken: true },
  })
  if (!connection) {
    return { success: false, error: "The mailbox chosen to send this email is no longer connected. Reconnect it or choose another." }
  }

  const accessToken = await refreshMailboxAccess(settings as MicrosoftApp, connection)
  if (!accessToken) {
    return { success: false, error: "Couldn't refresh the connected mailbox's access. It may need to be reconnected." }
  }

  const sent = await postSendMail(accessToken, {
    subject: email.subject,
    body: { contentType: "HTML", content: email.bodyHtml },
    toRecipients: graphRecipients(email.to),
    ccRecipients: graphRecipients(email.cc),
    bccRecipients: graphRecipients(email.bcc),
    attachments: email.attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType,
      contentBytes: Buffer.from(a.bytes).toString("base64"),
    })),
  })
  return sent ? { success: true } : { success: false, error: "Microsoft rejected the email. Please try again." }
}
