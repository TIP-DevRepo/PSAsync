"use client"

// Copies text, answering false instead of throwing when the browser
// refuses (no permission, page not focused), so the caller can show the
// text instead
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
