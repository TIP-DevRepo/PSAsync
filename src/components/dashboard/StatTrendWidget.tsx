"use client"

import { useEffect, useState } from "react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetType } from "@/lib/dashboards/widgetTypes"

interface StatTrendData {
  count: number
  thisMonth: number
  lastMonth: number
  deltaPct: number
}

export function StatTrendWidget({ type, label }: { type: WidgetType; label: string }) {
  const [data, setData] = useState<StatTrendData | null>(null)
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

  const isUp = data.deltaPct > 0
  const isDown = data.deltaPct < 0
  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus
  const trendClass = isUp ? "text-success" : isDown ? "text-danger" : "text-muted-foreground"

  return (
    <div className="flex flex-1 flex-col justify-between gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold text-foreground">{data.count}</p>
      <div className={`flex items-center gap-1 text-xs font-medium ${trendClass}`}>
        <TrendIcon size={14} />
        <span>{Math.abs(data.deltaPct)}% vs last month</span>
      </div>
    </div>
  )
}
