// The rule for the quote, sales order, and purchase order number prefixes
// (Quote Settings and Sales Order Settings): letters, digits, and hyphens,
// 1 to 10 characters. The defaults (Q, SO, PO) follow it. A prefix becomes
// part of every number and of the PDF download name.
export const NUMBER_PREFIX_PATTERN = /^[A-Za-z0-9-]{1,10}$/

// null when the value may be saved, otherwise the message for the 400
export function numberPrefixProblem(value: unknown, label: string): string | null {
  if (typeof value === "string" && NUMBER_PREFIX_PATTERN.test(value)) return null
  return `${label} prefix can only use letters, numbers, and hyphens, from 1 to 10 characters`
}
