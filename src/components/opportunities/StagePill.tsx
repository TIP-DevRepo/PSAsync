import { CATEGORY_LABELS } from "@/lib/opportunity-rules"
import type { StageCategory } from "@/lib/opportunity-view"
import { TONE_TINT, type Tone } from "@/components/ui/blocks"
import { cn } from "@/lib/utils"

// Tinted pills in the shared tones (StatusPill's): Open stages in the
// accent, Won in the fixed success color, Lost in the fixed danger color
export const CATEGORY_TONE: Record<StageCategory, Tone> = {
  OPEN: "accent",
  WON: "ok",
  LOST: "bad",
}

const PILL = "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5"

export function CategoryPill({ category, className }: { category: StageCategory; className?: string }) {
  return <span className={cn(PILL, "shrink-0", TONE_TINT[CATEGORY_TONE[category]], className)}>{CATEGORY_LABELS[category]}</span>
}

// A stage's name, tinted by its category
export function StagePill({ name, category, className }: { name: string; category: StageCategory; className?: string }) {
  return (
    <span className={cn(PILL, TONE_TINT[CATEGORY_TONE[category]], className)} title={`${name} (${CATEGORY_LABELS[category]})`}>
      <span className="truncate">{name}</span>
    </span>
  )
}
