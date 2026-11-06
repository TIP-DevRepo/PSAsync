"use client"

import Link from "next/link"
import { TopbarPortal } from "@/components/layout/TopbarSlots"
import { cn } from "@/lib/utils"

export interface Crumb {
  label: string
  href: string
}

interface BreadcrumbsProps {
  // Crumbs before the current page, each linking to its page
  items?: Crumb[]
  // The current page's name. Pass null while it is still loading to show a
  // placeholder instead, so a raw id is never shown.
  current: string | null
  className?: string
}

// Shared trail for every page: ...items / current, shown in the top bar
// (TopbarPortal) as the design draws it, the earlier crumbs muted links and
// the current page in bold. Pages keep rendering <Breadcrumbs> where they
// always did; on pages outside the dashboard it shows in place. Crumbs
// truncate with an ellipsis instead of ever widening the bar.
export function Breadcrumbs({ items = [], current, className }: BreadcrumbsProps) {
  return (
    <TopbarPortal slot="crumbs">
      <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
        <ol className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          {items.map((crumb) => (
            <li key={crumb.href} className="flex min-w-0 shrink items-center gap-2">
              <Link
                href={crumb.href}
                title={crumb.label}
                className="min-w-0 truncate rounded-sm transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {crumb.label}
              </Link>
              <span aria-hidden="true">/</span>
            </li>
          ))}
          <li className="flex min-w-0 shrink items-center">
            {current ? (
              <span aria-current="page" title={current} className="min-w-0 truncate font-semibold text-foreground">
                {current}
              </span>
            ) : (
              <span aria-current="page" className="flex items-center">
                <span className="sr-only">Loading</span>
                <span aria-hidden="true" className="h-3.5 w-24 animate-pulse rounded bg-muted" />
              </span>
            )}
          </li>
        </ol>
      </nav>
    </TopbarPortal>
  )
}
