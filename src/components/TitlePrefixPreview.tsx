import { prefixedTitle } from "@/lib/record-title"

// Under a new ticket's or opportunity's title: what the server will save
// once the chosen client's prefix is added (src/lib/record-title.ts).
// Nothing while there is no title or the client has no prefix. Plain
// markup, no client hooks.
export function TitlePrefixPreview({ title, prefix, id }: { title: string; prefix: string | null | undefined; id?: string }) {
  if (!title.trim() || !prefix?.trim()) return null
  return (
    <p id={id} className="mt-1 text-xs text-muted-foreground">
      Will be saved as: <span className="font-medium text-foreground">{prefixedTitle(title, prefix)}</span>
    </p>
  )
}
