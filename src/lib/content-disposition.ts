// The one way a download name is put into a Content-Disposition header:
// the quote PDFs (staff and portal), stored attachments (src/lib/uploads.ts),
// and the PDF attached to a quote email. A name built from stored values (a
// quote number made from a company's prefix, an uploaded file's name) can
// hold anything, so it is cleaned first and then written twice: an ASCII
// fallback in quotes, and the exact name encoded per RFC 5987. Nothing in a
// name can break the header, add a header, or point outside the download.
// No server imports, so it is safe anywhere.

export const MAX_DOWNLOAD_NAME_LENGTH = 150

// The name with control characters (line breaks included) and path
// separators removed and whitespace collapsed, at most
// MAX_DOWNLOAD_NAME_LENGTH characters with its extension kept, or fallback
// when nothing is left
export function safeDownloadName(name: string, fallback = "download"): string {
  let clean = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!clean) return fallback
  if (clean.length > MAX_DOWNLOAD_NAME_LENGTH) {
    const dot = clean.lastIndexOf(".")
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : ""
    clean = `${clean.slice(0, MAX_DOWNLOAD_NAME_LENGTH - ext.length).trimEnd()}${ext}`
  }
  return clean
}

// attachment; filename="<ascii fallback>"; filename*=UTF-8''<encoded name>
export function attachmentDisposition(name: string, fallback = "download"): string {
  const clean = safeDownloadName(name, fallback)
  const ascii = clean.replace(/[^\x20-\x7e]|["\\%]/g, "_")
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

// A quote PDF's download name, e.g. Q-2026-0001-v2.pdf
export function quotePdfName(quoteNumber: string, version: number): string {
  return safeDownloadName(`${quoteNumber}${version > 1 ? `-v${version}` : ""}.pdf`, "quote.pdf")
}
