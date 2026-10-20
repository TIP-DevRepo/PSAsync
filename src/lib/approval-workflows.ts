import { prisma } from "@/lib/prisma"

// The one place a quote is checked against its company's approval
// workflows. Used by POST quotes/[id]/send, POST quotes/[id]/send-email,
// POST quotes/[id]/status, and the approval completion in
// src/lib/quote-approval.ts, so every path that can move a quote out of
// DRAFT or PENDING_APPROVAL decides the same way. Kept free of the email
// sender, so the status route doesn't load the PDF renderer.

// The email composed in the Send Quote dialog, held on the quote
// (pendingEmailPayload) while it waits for approval
export interface HeldEmail {
  to: string
  cc: string | null
  subject: string
  bodyHtml: string
  includePdf: boolean
  // The rep's plain text message, so the dialog can show it again.
  // Missing on emails held before it was stored.
  message?: string
  // The mailbox chosen when Send was clicked. Missing on emails held
  // before the sender was stored.
  connectionId?: string
  sentByUserId?: string
  sentByName?: string
  // Set only when every approval was granted but the email couldn't be
  // sent: why, and what the approvals were granted for
  lastSendError?: string
  approvedFingerprint?: string
}

export interface ApprovalLine {
  id: string
  quantity: number
  unitPrice: number
  discount: number
}

export interface ApprovalQuote {
  id: string
  userId: string
  lineItems: ApprovalLine[]
  pendingEmailPayload?: unknown
}

export interface WorkflowRule {
  id: string
  triggerType: string
  thresholdValue: number | null
  triggerUserId: string | null
}

// What the approval workflows look at (the owner, and each line item's
// quantity, price, and discount), so approvals already granted can be
// honored only while none of it has changed
export function approvalFingerprint(userId: string, lineItems: ApprovalLine[]): string {
  const items = [...lineItems]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((li) => [li.id, li.quantity, li.unitPrice, li.discount])
  return JSON.stringify([userId, items])
}

// The workflows a quote triggers, from the company's active ones
export function matchingWorkflows<W extends WorkflowRule>(workflows: W[], quote: Pick<ApprovalQuote, "userId" | "lineItems">): W[] {
  const total = quote.lineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity * (1 - li.discount / 100), 0)
  const maxDiscount = quote.lineItems.reduce((max, li) => Math.max(max, li.discount), 0)
  return workflows.filter((w) => {
    if (w.triggerType === "TOTAL_THRESHOLD") return w.thresholdValue != null && total >= w.thresholdValue
    if (w.triggerType === "DISCOUNT_THRESHOLD") return w.thresholdValue != null && maxDiscount >= w.thresholdValue
    if (w.triggerType === "SPECIFIC_USER") return w.triggerUserId === quote.userId
    return false
  })
}

export async function loadMatchingWorkflows(companyId: string, quote: Pick<ApprovalQuote, "userId" | "lineItems">) {
  const workflows = await prisma.approvalWorkflow.findMany({ where: { companyId, active: true } })
  return matchingWorkflows(workflows, quote)
}

// Whether the approvals already granted for this quote still count: only
// for an email that was approved and then couldn't be sent, only while
// nothing the workflows look at has changed since, and only when every
// matching workflow is APPROVED. Anything else asks again.
export async function approvalsStillGranted(quote: ApprovalQuote, matched: WorkflowRule[]): Promise<boolean> {
  if (matched.length === 0) return false
  const held = quote.pendingEmailPayload as Partial<HeldEmail> | null
  if (!held?.approvedFingerprint || held.approvedFingerprint !== approvalFingerprint(quote.userId, quote.lineItems)) return false
  const approved = await prisma.quoteApproval.count({
    where: { quoteId: quote.id, workflowId: { in: matched.map((w) => w.id) }, status: "APPROVED" },
  })
  return approved === matched.length
}
