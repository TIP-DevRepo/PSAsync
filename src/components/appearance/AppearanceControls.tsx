"use client"

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Check } from "lucide-react"
import { Card, CardHeader, StatusPill } from "@/components/ui/blocks"
import { cn } from "@/lib/utils"
import {
  accentReadability,
  ACCENT_PRESETS,
  buildTheme,
  DENSITY_LABELS,
  MODE_LABELS,
  onColor,
  readHexInput,
  ROW_DENSITIES,
  SIDEBAR_LABELS,
  SIDEBAR_STYLES,
  THEME_MODES,
  type ResolvedTheme,
  type RowDensityChoice,
  type SidebarStyle,
  type ThemeModeChoice,
} from "@/lib/theme"

// The Appearance controls, as the design draws them, shared by My settings
// > Appearance (a user's own colors) and Settings > Appearance (the company
// defaults). Each is a real radio group: arrow keys move the choice, Tab
// leaves the group.

// Arrow keys, Home, and End move the choice in a radio group
function radioKeys<T>(e: KeyboardEvent, options: readonly T[], current: T, pick: (value: T) => void, refs: (HTMLButtonElement | null)[]) {
  const i = Math.max(0, options.indexOf(current))
  let next = i
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length
  else if (e.key === "Home") next = 0
  else if (e.key === "End") next = options.length - 1
  else return
  e.preventDefault()
  pick(options[next])
  refs[next]?.focus()
}

// ─── Accent color ───────────────────────────────────────────────────────────

export function AccentPicker({ value, onChange, disabled = false }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // What the custom box holds while typing; follows a preset pick
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  const hexes = ACCENT_PRESETS.map((p) => p.hex)
  const selectedIndex = hexes.findIndex((h) => h.toLowerCase() === value.toLowerCase())
  const typed = readHexInput(draft)
  const readability = accentReadability(typed ?? value)

  return (
    <Card className="flex flex-col gap-3.5">
      <CardHeader title="Accent color" description="Used for buttons, links, selected items and highlights. Status colors stay the same." />
      <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2.5">
        {ACCENT_PRESETS.map((preset, i) => {
          const selected = i === selectedIndex
          return (
            <button
              key={preset.hex}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.name}
              title={preset.name}
              disabled={disabled}
              tabIndex={selected || (selectedIndex === -1 && i === 0) ? 0 : -1}
              onClick={() => onChange(preset.hex)}
              onKeyDown={(e) => radioKeys(e, hexes, selectedIndex === -1 ? hexes[0] : hexes[selectedIndex], onChange, refs.current)}
              className="flex h-11 w-11 items-center justify-center rounded-[12px] transition-transform duration-100 hover:scale-[1.06] focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
              style={{
                background: preset.hex,
                color: onColor(preset.hex),
                boxShadow: selected ? `0 0 0 3px var(--ps-surface), 0 0 0 5px ${preset.hex}` : "none",
              }}
            >
              {selected && <Check size={18} strokeWidth={3} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="appearance-custom-accent" className="text-[13px] text-muted-foreground">
          Custom color
        </label>
        <input
          id="appearance-custom-accent"
          value={draft}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          aria-describedby="appearance-accent-readability"
          aria-invalid={draft.trim() !== "" && !typed}
          onChange={(e) => {
            setDraft(e.target.value)
            const hex = readHexInput(e.target.value)
            if (hex && hex.toLowerCase() !== value.toLowerCase()) onChange(hex)
          }}
          className="w-[120px] rounded-control border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm uppercase text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <span id="appearance-accent-readability" aria-live="polite">
          {typed ? (
            <StatusPill tone={readability.readable ? "ok" : "warn"} className="whitespace-normal text-[13px]">
              {readability.label}
            </StatusPill>
          ) : (
            <span className="text-[13px] text-muted-foreground">Type a color like #5E56E0</span>
          )}
        </span>
      </div>
    </Card>
  )
}

// ─── Sidebar style ──────────────────────────────────────────────────────────

export function SidebarStylePicker({ value, accent, onChange, disabled = false }: { value: SidebarStyle; accent: string; onChange: (s: SidebarStyle) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <Card className="flex flex-col gap-3.5">
      <CardHeader title="Sidebar style" />
      <div role="radiogroup" aria-label="Sidebar style" className="flex flex-wrap gap-3">
        {SIDEBAR_STYLES.map((style, i) => {
          const checked = style === value
          return (
            <button
              key={style}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(style)}
              onKeyDown={(e) => radioKeys(e, SIDEBAR_STYLES, value, onChange, refs.current)}
              className={cn(
                "flex flex-[1_1_160px] flex-col gap-2 rounded-[12px] border-2 bg-card p-2.5 text-left text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
                checked ? "border-acc" : "border-border hover:border-muted-foreground/40"
              )}
            >
              <SidebarSwatch style={style} accent={accent} />
              <span className="font-semibold">{SIDEBAR_LABELS[style]}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// The card's little picture: the sidebar's color next to the page. The
// dark one follows the mode like the real sidebar does.
function SidebarSwatch({ style, accent }: { style: SidebarStyle; accent: string }) {
  const light = buildTheme(accent, style, false).sbBg
  const dark = buildTheme(accent, style, true).sbBg
  return (
    <span aria-hidden="true" className="flex h-16 overflow-hidden rounded-[8px] border border-border">
      <span className="w-[34%] dark:hidden" style={{ background: style === "LIGHT" ? "var(--ps-surface)" : light }} />
      <span className="hidden w-[34%] dark:block" style={{ background: style === "LIGHT" ? "var(--ps-surface)" : dark }} />
      <span className="flex-1 bg-background" />
    </span>
  )
}

// ─── Mode ───────────────────────────────────────────────────────────────────

export function ModeSwitch({ value, onChange, disabled = false }: { value: ThemeModeChoice; onChange: (m: ThemeModeChoice) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <Card className="flex flex-col gap-3.5">
      <CardHeader title="Mode" />
      <div role="radiogroup" aria-label="Mode" className="inline-flex flex-wrap gap-1 self-start rounded-[10px] border border-border bg-surface-2 p-1">
        {THEME_MODES.map((mode, i) => {
          const checked = mode === value
          return (
            <button
              key={mode}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(mode)}
              onKeyDown={(e) => radioKeys(e, THEME_MODES, value, onChange, refs.current)}
              className={cn(
                "min-h-9 rounded-[7px] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                checked ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {MODE_LABELS[mode]}
            </button>
          )
        })}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {value === "SYSTEM" ? "Follows your computer's light or dark setting." : "Applies on every device you sign in from."}
      </p>
    </Card>
  )
}

// ─── Row density ────────────────────────────────────────────────────────────

const DENSITY_NOTES: Record<RowDensityChoice, string> = {
  COMPACT: "More rows on screen",
  DEFAULT: "Balanced",
  COMFORTABLE: "More room around each row",
}

export function DensityPicker({ value, onChange }: { value: RowDensityChoice; onChange: (d: RowDensityChoice) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <Card className="flex flex-col gap-3.5">
      <CardHeader title="Row density" description="How tall rows are in lists like Quotes, Clients, and Sales Orders." />
      <div role="radiogroup" aria-label="Row density" className="inline-flex flex-wrap gap-1 self-start rounded-[10px] border border-border bg-surface-2 p-1">
        {ROW_DENSITIES.map((density, i) => {
          const checked = density === value
          return (
            <button
              key={density}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              title={DENSITY_NOTES[density]}
              onClick={() => onChange(density)}
              onKeyDown={(e) => radioKeys(e, ROW_DENSITIES, value, onChange, refs.current)}
              className={cn(
                "min-h-9 rounded-[7px] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                checked ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {DENSITY_LABELS[density]}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Status colors ──────────────────────────────────────────────────────────

export function StatusColorsCard() {
  return (
    <Card className="flex flex-col gap-2.5">
      <CardHeader title="Status colors" description="Fixed for everyone so they always mean the same thing." />
      <div className="flex flex-wrap gap-2">
        <StatusPill tone="ok">Won, Resolved</StatusPill>
        <StatusPill tone="warn">Waiting on customer</StatusPill>
        <StatusPill tone="bad">Lost, Overdue, Urgent</StatusPill>
        <StatusPill tone="neutral">On hold, Draft</StatusPill>
      </div>
    </Card>
  )
}

// ─── Switch ─────────────────────────────────────────────────────────────────

export function Switch({ checked, onChange, label, description, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-semibold text-foreground">
          {label}
        </p>
        {description && (
          <p id={`${id}-description`} className="mt-0.5 text-[13px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          checked ? "border-acc bg-acc" : "border-border bg-neu-tint"
        )}
      >
        <span
          aria-hidden="true"
          className={cn("inline-block h-[18px] w-[18px] rounded-full shadow transition-transform duration-150", checked ? "translate-x-[22px] bg-acc-on" : "translate-x-[3px] bg-muted-foreground")}
        />
      </button>
    </div>
  )
}

// A small picture of a theme in both modes, for the company defaults: the
// sidebar, a card with the main button, a tinted pill, and a link
export function ThemePreviewPair({ theme }: { theme: ResolvedTheme }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[false, true].map((dark) => {
        const t = buildTheme(theme.accent, theme.sidebar, dark)
        return (
          <figure key={String(dark)} className="m-0 overflow-hidden rounded-card border border-border">
            <div className="flex h-28" style={{ background: t.bg }}>
              <div className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: t.sbBg }}>
                <span className="h-3 w-3 rounded-[4px]" style={{ background: t.acc }} />
                <span className="h-2 w-[80%] rounded-full" style={{ background: t.sbMuted, opacity: 0.6 }} />
                <span className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: t.sbActive, color: t.sbActiveText }}>
                  Selected
                </span>
              </div>
              <div className="flex flex-1 flex-col justify-center gap-2 p-3">
                <div className="flex flex-wrap items-center gap-2 rounded-[8px] border p-2" style={{ background: t.surface, borderColor: t.border }}>
                  <span className="rounded-[6px] px-2 py-1 text-[11px] font-semibold" style={{ background: t.acc, color: t.accOn }}>
                    Button
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: t.accTint, color: t.accInk }}>
                    Pill
                  </span>
                  <span className="text-[11px] font-medium underline" style={{ color: t.accInk }}>
                    Link
                  </span>
                </div>
              </div>
            </div>
            <figcaption className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{dark ? "Dark mode" : "Light mode"}</figcaption>
          </figure>
        )
      })}
    </div>
  )
}
