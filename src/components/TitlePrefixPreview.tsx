import { checkPrefixedTitle, prefixedTitle } from "@/lib/record-title"
import { cn } from "@/lib/utils"

// Under a new ticket's or opportunity's title: what the server will save
// once the chosen client's prefix is added (src/lib/record-title.ts), and
// its length against the limit, which counts the prefix. Over the limit it
// says so in the danger color, the same message the server answers.
// Nothing while there is no title or the client has no prefix. Plain
// markup, no client hooks.
export function TitlePrefixPreview({ title, prefix, max, id }: { title: string; prefix: string | null | undefined; max: number; id?: string }) {
  if (!title.trim() || !prefix?.trim()) return null
  const saved = prefixedTitle(title, prefix)
  const check = checkPrefixedTitle(title, prefix, max)
  return (
    <div id={id} className="mt-1 space-y-0.5 text-xs">
      <p className="text-muted-foreground">
        Will be saved as: <span className="break-words font-medium text-foreground">{saved}</span>{" "}
        <span className={cn("tabular-nums", check.error !== undefined && "font-medium text-danger")}>
          ({saved.length} of {max} characters)
        </span>
      </p>
      {check.error !== undefined && (
        <p role="alert" className="text-danger">
          {check.error}
        </p>
      )}
    </div>
  )
}
