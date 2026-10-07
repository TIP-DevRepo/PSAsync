"use client"

import Link from "next/link"
import { Breadcrumbs as HeroBreadcrumbs } from "@heroui/react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Crumb {
  label: string
  href: string
}

interface BreadcrumbsProps {
  // Crumbs between Dashboard and the current page, each linking to its page.
  items?: Crumb[]
  // The current page's name. Pass null while it is still loading to show a
  // placeholder instead, so a raw id is never shown.
  current: string | null
  className?: string
}

// Shared trail shown at the top of nested pages: Dashboard / ...items / current.
// Built on HeroUI's Breadcrumbs for the list structure. Each crumb renders its
// own next/link so navigation stays client side and colors use the app's
// tokens (HeroUI's default "muted" text color maps to a background gray here).
// The line height is fixed so the page does not jump when the name loads, and
// crumbs truncate with an ellipsis instead of ever widening the page.
export function Breadcrumbs({ items = [], current, className }: BreadcrumbsProps) {
  const trail: Crumb[] = [{ label: "Dashboard", href: "/dashboard" }, ...items]

  return (
    <nav aria-label="Breadcrumb" className={cn("mb-2 h-5 min-w-0", className)}>
      <HeroBreadcrumbs className="h-5 min-w-0 flex-nowrap">
        {trail.map((crumb, i) => (
          <HeroBreadcrumbs.Item
            key={crumb.href}
            id={crumb.href}
            className={cn("min-w-0 gap-1", i === 0 ? "shrink-0" : "shrink")}
          >
            {() => (
              <>
                <Link
                  href={crumb.href}
                  title={crumb.label}
                  className="min-w-0 truncate rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {crumb.label}
                </Link>
                <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground" />
              </>
            )}
          </HeroBreadcrumbs.Item>
        ))}
        <HeroBreadcrumbs.Item id="current" className="min-w-0 shrink">
          {() =>
            current ? (
              <span aria-current="page" title={current} className="min-w-0 truncate text-sm font-medium text-foreground">
                {current}
              </span>
            ) : (
              <span aria-current="page" className="flex items-center">
                <span className="sr-only">Loading</span>
                <span aria-hidden="true" className="h-3.5 w-24 animate-pulse rounded bg-muted" />
              </span>
            )
          }
        </HeroBreadcrumbs.Item>
      </HeroBreadcrumbs>
    </nav>
  )
}
