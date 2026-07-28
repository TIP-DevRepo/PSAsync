"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Sun, Moon, Monitor } from "lucide-react"

const OPTIONS = [
  { key: "light", label: "Light", Icon: Sun },
  { key: "dark", label: "Dark", Icon: Moon },
  { key: "system", label: "System", Icon: Monitor },
] as const

type ThemeKey = (typeof OPTIONS)[number]["key"]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [pill, setPill] = useState({ left: 0, width: 0 })

  useEffect(() => setMounted(true), [])

  const active: ThemeKey = mounted ? (theme as ThemeKey) ?? "system" : "dark"

  useLayoutEffect(() => {
    const btn = btnRefs.current[active]
    if (btn) setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [active, mounted])

  // Avoid rendering theme-dependent state before hydration to prevent a
  // flash of the wrong active icon
  if (!mounted) {
    return <div className="h-8 w-[6.5rem] rounded-full bg-muted" />
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="relative inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5"
    >
      <div
        className="absolute top-0.5 bottom-0.5 rounded-full bg-card shadow-card transition-[left,width] duration-250 ease-out"
        style={{ left: pill.left, width: pill.width }}
      />
      {OPTIONS.map(({ key, label, Icon }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            ref={(el) => {
              btnRefs.current[key] = el
            }}
            role="radio"
            aria-checked={isActive}
            title={label}
            onClick={() => setTheme(key)}
            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={14} />
          </button>
        )
      })}
    </div>
  )
}