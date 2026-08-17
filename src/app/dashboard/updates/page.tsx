import Image from "next/image"
import { PRODUCT_UPDATES, PSASYNC_OVERVIEW, type UpdateCategory } from "@/lib/product-updates"

const CATEGORY_COLORS: Record<UpdateCategory, string> = {
  "New Feature": "bg-success-bg text-success",
  Improvement: "bg-info-bg text-info",
  Fix: "bg-warning-bg text-warning",
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export default function UpdatesPage() {
  const [latest, ...rest] = PRODUCT_UPDATES

  return (
    <div className="w-full max-w-3xl space-y-8">
      <div className="flex items-center gap-4">
        <Image src="/icon.png" alt="PSAsync" width={64} height={64} className="rounded-lg shadow-elevated" />
        <div>
          <h1 className="text-display font-semibold tracking-tight text-foreground">PSAsync</h1>
          <p className="text-sm font-medium text-muted-foreground">Unified MSP Solution</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">{PSASYNC_OVERVIEW}</p>

      <div>
        <h2 className="text-heading font-semibold tracking-tight text-foreground">Features &amp; Updates</h2>
        <p className="text-muted-foreground mt-1">See what&apos;s new in PSAsync.</p>
      </div>

      {latest && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 shadow-elevated p-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
              Latest
            </span>
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${CATEGORY_COLORS[latest.category]}`}>
              {latest.category}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">{latest.version}</span>
          </div>
          <h2 className="text-heading font-semibold text-foreground">{latest.title}</h2>
          <p className="text-sm text-muted-foreground">{formatDate(latest.date)}</p>
          <p className="text-sm text-foreground">{latest.description}</p>
        </div>
      )}

      {rest.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Past Updates</h3>
          <div className="space-y-3">
            {rest.map((update) => (
              <div
                key={`${update.version}-${update.title}`}
                className="rounded-lg border border-border bg-card shadow-card p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${CATEGORY_COLORS[update.category]}`}>
                    {update.category}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">{update.version}</span>
                </div>
                <h4 className="font-medium text-foreground">{update.title}</h4>
                <p className="text-xs text-muted-foreground">{formatDate(update.date)}</p>
                <p className="text-sm text-muted-foreground">{update.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}