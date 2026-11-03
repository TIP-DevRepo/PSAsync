import sanitizeHtml from "sanitize-html"
import { escapeHtmlWithBreaks } from "@/lib/html"

// Server side only: never import this from a client component or from a
// file a client component imports. The browser only ever renders terms
// strings that an API response already sanitized.
//
// Quote terms (Quote.terms, QuoteTemplate.terms, and the company default
// CompanySettings.quoteTerms) and timeline notes (TimelineEntry.body, through
// src/lib/timeline.ts) are rich text from the TipTap editor in
// src/components/ui/rich-text-editor.tsx, which enables StarterKit only.
// The allowlist below is exactly what StarterKit's extensions render:
//   Paragraph p, HardBreak br, Bold strong, Italic em, Strike s,
//   Underline u, Code code, CodeBlock pre (with code inside), Blockquote
//   blockquote, BulletList ul, OrderedList ol, ListItem li, Heading h1 to
//   h6, HorizontalRule hr, Link a.
// Document, Text, Dropcursor, Gapcursor, ListKeymap, TrailingNode, and
// UndoRedo render no markup. Attributes: a keeps href (http, https, and
// mailto only) with rel and target forced; ol keeps start (a whole
// number) and type (1, a, A, i, I), which OrderedList writes for lists
// that don't start at 1 or use letters or roman numerals. Nothing else
// keeps an attribute, so the code block's language class is dropped (it
// only matters to a syntax highlighter, which nothing here uses).

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "u",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "a",
]

const ALLOWED_HREF = /^(https?:\/\/|mailto:)/i

// Browsers ignore spaces, tabs, newlines, and control characters inside a
// URL scheme, so they're removed before the scheme is checked
function withoutSpaceOrControl(value: string): string {
  let out = ""
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code > 0x20 && (code < 0x7f || code > 0xa0)) out += ch
  }
  return out
}
const ORDERED_LIST_TYPES = new Set(["1", "a", "A", "i", "I"])

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "rel", "target"],
    ol: ["start", "type"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // These tags go with everything inside them, not just the tag itself
  nonTextTags: [
    "script",
    "style",
    "textarea",
    "option",
    "noscript",
    "title",
    "template",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "xmp",
    "noembed",
    "noframes",
    "plaintext",
    "select",
  ],
  transformTags: {
    a: (tagName, attribs) => {
      const attributes: Record<string, string> = { rel: "noopener noreferrer", target: "_blank" }
      // Entities are already decoded here; whitespace and control
      // characters are removed before the scheme check so "java\tscript:"
      // and " javascript:" can't slip past it
      const href = withoutSpaceOrControl(attribs.href ?? "")
      if (ALLOWED_HREF.test(href)) attributes.href = attribs.href.trim()
      return { tagName, attribs: attributes }
    },
    ol: (tagName, attribs) => {
      const attributes: Record<string, string> = {}
      if (attribs.start && /^\d{1,6}$/.test(attribs.start)) attributes.start = attribs.start
      if (attribs.type && ORDERED_LIST_TYPES.has(attribs.type)) attributes.type = attribs.type
      return { tagName, attribs: attributes }
    },
  },
}

// Sanitized HTML for a terms value. null and undefined give null, an
// empty string gives an empty string. Running it on its own output
// returns the same string.
export function sanitizeTermsHtml(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  if (!input) return ""
  return sanitizeHtml(input, OPTIONS)
}

// A tag, comment, or character entity anywhere in the value. "<30 days"
// and "a < b" are not tags: a tag name starts with a letter right after
// the "<". A bare "&" is not an entity either.
const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>|<!|&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i

// What every place that shows terms uses. The editor always writes HTML,
// but terms saved before it (from a plain textarea) are plain text with
// newlines, and may hold "<" or "&" as text. A value with no tags or
// entities is escaped and keeps its line breaks; anything else is
// sanitized. Both branches end in the sanitizer, and its output always
// reads as HTML again (or as plain text with nothing to escape), so the
// result is the same whether this runs once or twice.
export function termsToDisplayHtml(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (!value) return ""
  if (!LOOKS_LIKE_HTML.test(value)) return sanitizeTermsHtml(escapeHtmlWithBreaks(value))
  const html = sanitizeTermsHtml(value) ?? ""
  // Nothing left that marks it as HTML: newlines in it only ever render
  // as spaces, so keep them as spaces rather than let a second pass turn
  // them into line breaks
  return LOOKS_LIKE_HTML.test(html) ? html : html.replace(/\s*\r?\n\s*/g, " ")
}

// For writes: a request body value or a value copied from another record.
// Anything that isn't a string, or sanitizes down to nothing, is stored
// as null, the same as an empty value today.
export function termsForStorage(value: unknown): string | null {
  if (typeof value !== "string") return null
  return termsToDisplayHtml(value) || null
}

// For a row leaving the server that may carry terms: the same row with
// its terms made safe to render. Rows without a terms field pass through.
export function withSafeTerms<T>(row: T): T {
  if (!row || typeof row !== "object" || !("terms" in row)) return row
  const terms = (row as { terms: unknown }).terms
  if (typeof terms !== "string") return row
  return { ...row, terms: termsToDisplayHtml(terms) }
}
