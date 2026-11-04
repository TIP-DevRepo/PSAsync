import { toast } from "@/lib/toast"

// Downloads a PDF route's file in the browser. Fetched rather than opened
// in a new tab, so a refusal (the PDF browser being unavailable, 503
// PDF_UNAVAILABLE, or a customer link used too often, 429) shows its plain
// message as a toast instead of a page of JSON. Used by the quote pages and
// the customer portal.
export async function downloadPdf(url: string, fallbackName = "quote.pdf"): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) toast.warning("Please wait before downloading again", data.error)
      else toast.error("Couldn't download the PDF", data.error || "Please try again.")
      return
    }
    const blob = await res.blob()
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] || fallbackName
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch {
    toast.error("Couldn't download the PDF", "Please try again.")
  }
}
