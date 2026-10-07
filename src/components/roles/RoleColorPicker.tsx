"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { ROLE_COLOR_PALETTE, NEUTRAL_ROLE_COLOR, isValidRoleColor } from "@/lib/role-colors"

// Preset swatches plus an optional custom hex. value is "#RRGGBB" or null
// for no color (neutral gray pill). Remount it (key on the role id) when
// switching roles so the hex field starts from the new role's color.
export function RoleColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null
  onChange: (color: string | null) => void
  disabled?: boolean
}) {
  const [hexText, setHexText] = useState(value ?? "")
  const hexInvalid = hexText !== "" && !isValidRoleColor(hexText)
  const current = value?.toUpperCase() ?? null

  function pick(color: string | null) {
    setHexText(color ?? "")
    onChange(color)
  }

  function handleHexChange(text: string) {
    const normalized = text.startsWith("#") || text === "" ? text : `#${text}`
    setHexText(normalized)
    if (normalized === "") onChange(null)
    else if (isValidRoleColor(normalized)) onChange(normalized.toUpperCase())
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Role color">
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          aria-label="No color"
          title="No color"
          disabled={disabled}
          onClick={() => pick(null)}
          className={`relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ${
            current === null ? "border-foreground" : "border-border"
          }`}
          style={{ backgroundColor: `color-mix(in oklab, ${NEUTRAL_ROLE_COLOR} 15%, transparent)` }}
        >
          {current === null && <Check size={14} aria-hidden="true" />}
        </button>
        {ROLE_COLOR_PALETTE.map((color) => {
          const selected = current === color
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color}
              title={color}
              disabled={disabled}
              onClick={() => pick(color)}
              className={`flex h-7 w-7 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 ${
                selected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""
              }`}
              style={{ backgroundColor: color }}
            >
              {selected && <Check size={14} className="text-white drop-shadow" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="role-color-hex" className="text-xs text-zinc-500">
          Custom
        </label>
        <input
          type="color"
          aria-label="Pick a custom color"
          value={current ?? NEUTRAL_ROLE_COLOR}
          disabled={disabled}
          onChange={(e) => pick(e.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded-md border bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          id="role-color-hex"
          type="text"
          value={hexText}
          disabled={disabled}
          maxLength={7}
          placeholder="#3B82F6"
          spellCheck={false}
          aria-invalid={hexInvalid}
          aria-describedby={hexInvalid ? "role-color-hex-error" : undefined}
          onChange={(e) => handleHexChange(e.target.value.trim())}
          className={`w-28 rounded-md border px-2 py-1.5 font-mono text-sm uppercase disabled:opacity-60 ${
            hexInvalid ? "border-red-500" : ""
          }`}
        />
      </div>
      {hexInvalid && (
        <p id="role-color-hex-error" className="text-xs text-red-600 dark:text-red-400">
          Use a 6 digit hex color, like #3B82F6.
        </p>
      )}
    </div>
  )
}
