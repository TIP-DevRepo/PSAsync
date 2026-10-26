import { CATEGORY_LABELS } from "@/lib/opportunity-rules"
import type { StageCategory } from "@/lib/opportunity-view"
import { cn } from "@/lib/utils"

// Tinted pills in the brand and status tokens: Open stages in the brand
// color, Won in success, Lost in danger
const CATEGORY_TINT: Record<StageCategory, string> = {
  OPEN: "bg-brand-primary-500/10 text-brand-primary-500",
  WON: "bg-success/10 text-success",
  LOST: "bg-danger/10 text-danger",
}

const PILL = "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium"

export function CategoryPill({ category, className }: { category: StageCategory; className?: string }) {
  return <span className={cn(PILL, "shrink-0", CATEGORY_TINT[category], className)}>{CATEGORY_LABELS[category]}</span>
}

// A stage's name, tinted by its category
export function StagePill({ name, category, className }: { name: string; category: StageCategory; className?: string }) {
  return (
    <span className={cn(PILL, CATEGORY_TINT[category], className)} title={`${name} (${CATEGORY_LABELS[category]})`}>
      <span className="truncate">{name}</span>
    </span>
  )
}
