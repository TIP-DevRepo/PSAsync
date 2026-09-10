"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetType } from "@/lib/dashboards/widgetTypes"

interface GroupData {
  groups: { key: string; count: number }[]
}

export function GroupedCountWidget({
  type,
  label,
  linkParam,
}: {
  type: WidgetType
  label: string
  linkParam: "status" | "owner"
}) {
  const [data, setData] = useState<GroupData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/dashboards/widget-data?type=${type}`)
      .then((res) => {
        if (!res.ok) throw new Error("failed")
        return res.json()
      })
      .then(setData)
      .catch(() => setError(true))
  }, [type])

  if (error) return <p className="text-sm text-muted-foreground">Couldn't load this widget.</p>
  if (!data) return <WidgetSkeleton />

  const total = data.groups.reduce((sum, g) => sum + g.count, 0)

  return (
    <div className="flex flex-1 flex-col gap-2 min-h-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{total}</p>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {data.groups.map((g) => (
          <Link
            key={g.key}
            href={`/dashboard/inventory?${linkParam}=${encodeURIComponent(g.key)}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-between rounded-md bg-brand-secondary-500/10 px-2 py-1 text-xs text-brand-secondary-500 hover:bg-brand-secondary-500/20"
          >
            <span className="truncate">{g.key}</span>
            <span className="font-semibold">{g.count}</span>
          </Link>
        ))}
        {data.groups.length === 0 && <p className="text-xs text-muted-foreground">No assets yet.</p>}
      </div>
    </div>
  )
}
