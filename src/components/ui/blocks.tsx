import type { ComponentType, ReactNode } from "react"
import { Breadcrumbs, type Crumb } from "@/components/Breadcrumbs"
import { cn } from "@/lib/utils"
import type { RowDensityChoice } from "@/lib/theme"

// Not a client module: every block here is plain markup, so server and
// client components both use them, and an icon passed as a component
// (icon={Palette}) never crosses into the browser. ViewTabs handles clicks,
// so it lives in its own client module (src/components/ui/view-tabs.tsx).
//
// The shared building blocks of the new design (docs/design/ui-refresh-
// mockup.html), all colored by the theme variables (src/lib/theme.ts) so
// they follow every accent, sidebar style, and mode. PSAsync-Design-
// Rules.md says when to use each. New screens are built from these instead
// of their own one off styles or hardcoded colors.

type IconComponent = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>

// ─── Tones ──────────────────────────────────────────────────────────────────
// accent: the theme accent (selected, current, the record's own color)
// ok, warn, bad: the fixed status colors (won and resolved; waiting; lost,
// overdue, urgent), never following the accent
// neutral: on hold, draft, counts, anything without a meaning of its own
export type Tone = "accent" | "ok" | "warn" | "bad" | "neutral"

export const TONE_TINT: Record<Tone, string> = {
  accent: "bg-acc-tint text-acc-ink",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  neutral: "bg-neu-tint text-muted-foreground",
}

// ─── PageHeader ─────────────────────────────────────────────────────────────
// A page's title, a line under it, and its own actions. The breadcrumb goes
// to the top bar (Breadcrumbs does that by itself).
export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  breadcrumbs?: { items?: Crumb[]; current: string | null }
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs.items} current={breadcrumbs.current} />}
      <div className="min-w-0 flex-1 basis-60">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────
// A surface with a border. "panel" (14px corners, roomy) for page sections
// and record headers, "card" (12px) for side panels and timeline entries.
export function Card({
  children,
  className,
  size = "panel",
  as: As = "section",
  ...rest
}: {
  children: ReactNode
  className?: string
  size?: "panel" | "card"
  as?: "section" | "div" | "article" | "aside"
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <As
      className={cn(
        "border border-border bg-card text-card-foreground",
        size === "panel" ? "rounded-panel px-5 py-5 sm:px-[22px]" : "rounded-card p-4",
        className
      )}
      {...rest}
    >
      {children}
    </As>
  )
}

// A card's heading and the line that explains it
export function CardHeader({ title, description, id, actions }: { title: ReactNode; description?: ReactNode; id?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-foreground">
          {title}
        </h2>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

// ─── IconTile ───────────────────────────────────────────────────────────────
// A rounded square holding an icon, tinted by tone: lg (52px) for a record
// header, md (38px) for a stat tile, sm (34px) for list rows
const TILE_SIZE = {
  lg: { box: "h-[52px] w-[52px] rounded-[12px]", icon: 26 },
  md: { box: "h-[38px] w-[38px] rounded-[10px]", icon: 18 },
  sm: { box: "h-[34px] w-[34px] rounded-[9px]", icon: 18 },
} as const

export function IconTile({ icon: Icon, tone = "accent", size = "md", className }: { icon: IconComponent; tone?: Tone; size?: keyof typeof TILE_SIZE; className?: string }) {
  const s = TILE_SIZE[size]
  const tint = tone === "neutral" ? "bg-neu-tint text-foreground" : TONE_TINT[tone]
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", s.box, tint, className)}>
      <Icon size={s.icon} aria-hidden="true" />
    </span>
  )
}

// ─── StatusPill ─────────────────────────────────────────────────────────────
// A short tinted label: a stage, a status, a kind
export function StatusPill({ tone = "neutral", children, className, title, shape = "pill" }: { tone?: Tone; children: ReactNode; className?: string; title?: string; shape?: "pill" | "tag" }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap text-xs font-semibold",
        shape === "pill" ? "rounded-full px-2.5 py-1" : "rounded-md px-2 py-0.5",
        TONE_TINT[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

// ─── CountBadge ─────────────────────────────────────────────────────────────
// A small count next to a tab or a menu entry. "Nothing" shows nothing.
export function CountBadge({ count, tone = "neutral", label, className }: { count: number | null | undefined; tone?: "neutral" | "accent"; label?: string; className?: string }) {
  if (count === null || count === undefined) return null
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full px-[7px] py-px text-xs font-medium tabular-nums",
        tone === "accent" ? "bg-acc text-acc-on" : "bg-neu-tint text-muted-foreground",
        className
      )}
    >
      {count}
    </span>
  )
}

// ─── StatTile ───────────────────────────────────────────────────────────────
// One number at the top of a list page, with its icon and what it counts.
// Put several in a StatRow; they share the width and wrap on a phone.
export function StatTile({ label, value, icon, tone = "accent" }: { label: string; value: ReactNode; icon: IconComponent; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-[1_1_180px] items-center gap-3 rounded-card border border-border bg-card px-4 py-3.5">
      <IconTile icon={icon} tone={tone} size="md" />
      <span className="flex min-w-0 flex-col">
        <span className="text-[22px] font-bold leading-tight tabular-nums text-foreground">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  )
}

export function StatRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-3">
      {children}
    </div>
  )
}

// ─── Avatar ─────────────────────────────────────────────────────────────────
// A person's initials in a circle: accent tinted for a person, neutral for
// a former user, the system, or Unassigned
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]
  return letters.toUpperCase()
}

const AVATAR_SIZE = { sm: "h-[26px] w-[26px] text-[11px]", md: "h-[34px] w-[34px] text-xs", lg: "h-8 w-8 text-[13px]" } as const

export function InitialsAvatar({ name, tone = "accent", size = "md", className }: { name: string | null | undefined; tone?: "accent" | "neutral" | "solid"; size?: keyof typeof AVATAR_SIZE; className?: string }) {
  const tint = tone === "solid" ? "bg-acc text-acc-on" : tone === "accent" ? "bg-acc-tint text-acc-ink" : "bg-neu-tint text-foreground"
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold", AVATAR_SIZE[size], tint, className)}>
      {initialsOf(name)}
    </span>
  )
}

// ─── InfoPanelCard ──────────────────────────────────────────────────────────
// A side panel group of fields, label above value, under an uppercase
// heading (Client, Opportunity). InlineEditField sits inside as is: its
// hover outline is the field's own box. InfoField is the read only form.
export function InfoPanelCard({ title, children, id, className }: { title: string; children: ReactNode; id?: string; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-1 rounded-card border border-border bg-card p-4", className)}>
      <h2 id={id} className="mb-2 ml-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-col gap-1 px-1">{children}</div>
    </section>
  )
}

export function InfoField({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5 py-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="break-words text-sm font-medium text-foreground">{children}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

// ─── RecordHeaderCard ───────────────────────────────────────────────────────
// The top of a record's page: its icon tile, the title line (a name and the
// record's number), the line under it, pills and a menu on the right, a
// row of actions, and a summary strip of key facts.
export interface SummaryItem {
  label?: string
  value: ReactNode
}

export function RecordHeaderCard({
  icon,
  title,
  number,
  subtitle,
  side,
  actions,
  summary,
  children,
}: {
  icon: IconComponent
  title: ReactNode
  number?: ReactNode
  subtitle?: ReactNode
  // Pills and an overflow menu, on the right of the title
  side?: ReactNode
  actions?: ReactNode
  summary?: SummaryItem[]
  // Anything else between the actions and the summary (a banner)
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-border bg-card px-5 py-5 sm:px-6 sm:py-[22px]">
      <div className="flex flex-wrap items-start gap-4">
        <IconTile icon={icon} size="lg" />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="min-w-0 break-words text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">{title}</h1>
            {number && <span className="text-lg font-semibold tabular-nums text-muted-foreground">{number}</span>}
          </div>
          {subtitle && <div className="text-base text-foreground">{subtitle}</div>}
        </div>
        {side && <div className="flex flex-wrap items-center gap-2">{side}</div>}
      </div>
      {actions}
      {children}
      {summary && summary.length > 0 && (
        <dl className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
          {summary.map((item, i) => (
            <div key={i} className="flex min-w-0 items-baseline gap-1">
              {item.label && <dt>{item.label}</dt>}
              <dd className={cn("min-w-0", item.label && "font-semibold text-foreground")}>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

// ─── Tables ─────────────────────────────────────────────────────────────────
// The design's table look, as classes, for any list table: a card frame
// with its toolbar, a sideways scroll below the table's minimum width
// (columns keep their fixed widths, never squeezed), a tinted header row,
// a hover on each row. The row padding follows the user's row density.
export const TABLE = {
  frame: "overflow-hidden rounded-panel border border-border bg-card",
  toolbar: "flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-3",
  scroll: "overflow-x-auto",
  table: "w-full table-fixed border-collapse text-sm",
  headRow: "bg-surface-2 text-left text-xs text-muted-foreground",
  th: "px-3.5 py-2.5 font-semibold",
  row: "border-t border-border transition-colors hover:bg-surface-2",
  cellX: "px-3.5",
  // The record's number, in the accent ink
  number: "font-semibold tabular-nums text-acc-ink",
} as const

export const DENSITY_PADDING: Record<RowDensityChoice, string> = {
  COMPACT: "py-1.5",
  DEFAULT: "py-3",
  COMFORTABLE: "py-5",
}

// ─── Page layouts ───────────────────────────────────────────────────────────
// List and board pages fill the content area's full width (no max width
// container): the header, stat tiles, toolbar, and the list or board below
// all stretch with the screen.
export const LIST_PAGE = "flex w-full min-w-0 flex-col gap-[18px]"

export function ListPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(LIST_PAGE, className)}>{children}</div>
}

// A board: one column per stage (or status), all sharing the width equally
// and never narrower than BOARD_COLUMN_MIN_PX, so the six default stages fit
// a 1920px screen with the sidebar open and stretch on bigger ones. Only
// when the columns can't fit at that width (a small screen, or more stages)
// does the board scroll sideways, inside its own box.
export const BOARD_COLUMN_MIN_PX = 240
export const BOARD_GAP_PX = 16
export const BOARD_GRID = "grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-4 overflow-x-auto"

// The width a board needs before it scrolls: every column at its minimum
// plus the gaps between them
export function boardMinWidth(columns: number): number {
  return columns <= 0 ? 0 : columns * BOARD_COLUMN_MIN_PX + (columns - 1) * BOARD_GAP_PX
}

// A record page under its header card: the main column (the timeline and
// tabs) takes all the room, the info cards keep a fixed width on the right
// from lg up, and below lg they stack (the info cards first, as each page
// orders them)
export const RECORD_INFO_WIDTH_PX = 360
export const RECORD_LAYOUT = "grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"
