export function WidgetSkeleton() {
  return (
    <div className="flex-1 animate-pulse space-y-3">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="h-8 w-16 rounded bg-muted" />
      <div className="h-2 w-32 rounded bg-muted" />
    </div>
  )
}
