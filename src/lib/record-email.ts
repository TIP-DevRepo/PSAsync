import { parseRecipients } from "@/lib/email-address"

// The input rules for the Email action on a record (an opportunity now, a
// ticket later), shared by the email route and the composer. No React and
// no database imports.

// To, CC, and BCC together
export const RECORD_EMAIL_MAX_RECIPIENTS = 20
export const RECORD_EMAIL_SUBJECT_MAX = 255
// Attachments ticked on one email (their total size is limited separately,
// EMAIL_ATTACHMENTS_MAX_BYTES)
export const RECORD_EMAIL_MAX_ATTACHMENTS = 20

export const RECORD_EMAIL_MESSAGES = {
  noRecipient: "Add at least one recipient",
  tooManyRecipients: `An email can go to at most ${RECORD_EMAIL_MAX_RECIPIENTS} recipients`,
  subjectRequired: "Subject is required",
  messageRequired: "A message is required",
  subjectTooLong: `Subject must be ${RECORD_EMAIL_SUBJECT_MAX} characters or fewer`,
  invalidAttachments: "Invalid attachment",
  tooManyAttachments: `An email can have at most ${RECORD_EMAIL_MAX_ATTACHMENTS} attachments`,
  attachmentsTooLarge: (maxLabel: string) => `Attachments must be ${maxLabel} or less in total`,
} as const

// The default subject, for example "[OPP-2026-0001] Office refresh"
export function defaultEmailSubject(number: string, title: string): string {
  return `[${number}] ${title}`
}

// A subject with every line break (and other control character) turned
// into a space, so it can never add a header, then trimmed
export function cleanEmailSubject(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").trim()
}

export function readEmailSubject(value: unknown): { value: string; error?: undefined } | { error: string; value?: undefined } {
  const subject = typeof value === "string" ? cleanEmailSubject(value) : ""
  if (!subject) return { error: RECORD_EMAIL_MESSAGES.subjectRequired }
  if (subject.length > RECORD_EMAIL_SUBJECT_MAX) return { error: RECORD_EMAIL_MESSAGES.subjectTooLong }
  return { value: subject }
}

// A recipient field: a list of addresses, or one comma separated string
function readAddressList(value: unknown): { list: string[]; error?: undefined } | { error: string; list?: undefined } {
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === "string")) return { error: "Recipients must be a list of email addresses" }
    return parseRecipients(value.join(","))
  }
  return parseRecipients(value)
}

export interface EmailRecipients {
  to: string[]
  cc: string[]
  bcc: string[]
}

// To, CC, and BCC from a request: every address checked, at least one To,
// and at most RECORD_EMAIL_MAX_RECIPIENTS in all
export function readEmailRecipients(body: Record<string, unknown>): { value: EmailRecipients; error?: undefined } | { error: string; value?: undefined } {
  const to = readAddressList(body.to)
  if (to.error !== undefined) return { error: to.error }
  const cc = readAddressList(body.cc)
  if (cc.error !== undefined) return { error: cc.error }
  const bcc = readAddressList(body.bcc)
  if (bcc.error !== undefined) return { error: bcc.error }
  if (to.list.length === 0) return { error: RECORD_EMAIL_MESSAGES.noRecipient }
  if (to.list.length + cc.list.length + bcc.list.length > RECORD_EMAIL_MAX_RECIPIENTS) {
    return { error: RECORD_EMAIL_MESSAGES.tooManyRecipients }
  }
  return { value: { to: to.list, cc: cc.list, bcc: bcc.list } }
}

// The attachment ids ticked on an email: a list of distinct ids (left out
// is none). Whether they belong to the record is checked by the route.
export function readAttachmentIds(value: unknown): { value: string[]; error?: undefined } | { error: string; value?: undefined } {
  if (value === undefined || value === null) return { value: [] }
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v)) return { error: RECORD_EMAIL_MESSAGES.invalidAttachments }
  const ids = [...new Set(value as string[])]
  if (ids.length > RECORD_EMAIL_MAX_ATTACHMENTS) return { error: RECORD_EMAIL_MESSAGES.tooManyAttachments }
  return { value: ids }
}
