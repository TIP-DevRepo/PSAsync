"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { OPPORTUNITIES_FOLDER, TeamFolder, TICKETS_FOLDER, type TeamFolderConfig } from "./TeamFolder"
import { cn } from "@/lib/utils"
import { PsasyncMark } from "@/components/ui/blocks"
import { UserMenu } from "./UserMenu"

export interface PagePermissions {
  clients?: boolean
  catalog?: boolean
  vendors?: boolean
  quotes?: boolean
  opportunities?: boolean
  tickets?: boolean
  settings?: boolean
  salesOrders?: boolean
  purchaseOrders?: boolean
  inventory?: boolean
}

// The design's icons (docs/design/ui-refresh-mockup.html), one stroked path
// each, drawn at 18px like the rest of the sidebar
export const NAV_ICON_PATHS = {
  home: "M3 11 12 4l9 7M5 10v10h14V10",
  opp: "M3 17l6-6 4 4 8-8M15 7h6v6",
  ticket: "M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3v4ZM14 4v16",
  quote: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  so: "M5 7h14l-1 13H6zM9 7a3 3 0 0 1 6 0",
  po: "M3 7h18v12H3zM3 11h18M7 15h4",
  client: "M4 21V5l8-2 8 2v16M9 21v-5h6v5M8 9h2M14 9h2",
  vendor: "M3 20h18M5 20V9l7-5 7 5v11M10 20v-6h4v6",
  catalog: "M4 5h7v14H4zM13 5h7v6h-7zM13 13h7v6h-7z",
  inv: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  updates: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
} as const

export type NavIconName = keyof typeof NAV_ICON_PATHS

export function NavIcon({ name, size = 18 }: { name: NavIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={NAV_ICON_PATHS[name]} />
    </svg>
  )
}

interface NavItem {
  label: string
  href: string
  icon: NavIconName
  // null: every signed in user
  permissionKey: keyof PagePermissions | null
}

// Every page, in the design's sections. Each entry keeps the page gate it
// always had; a section shows only when one of its entries does.
export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "home", permissionKey: null },
      { label: "Tickets", href: "/dashboard/tickets", icon: "ticket", permissionKey: "tickets" },
      { label: "Opportunities", href: "/dashboard/opportunities", icon: "opp", permissionKey: "opportunities" },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Quotes", href: "/dashboard/quotes", icon: "quote", permissionKey: "quotes" },
      { label: "Sales Orders", href: "/dashboard/sales-orders", icon: "so", permissionKey: "salesOrders" },
      { label: "Purchase Orders", href: "/dashboard/purchase-orders", icon: "po", permissionKey: "purchaseOrders" },
    ],
  },
  {
    label: "Records",
    items: [
      { label: "Clients", href: "/dashboard/clients", icon: "client", permissionKey: "clients" },
      { label: "Vendors", href: "/dashboard/vendors", icon: "vendor", permissionKey: "vendors" },
      { label: "Catalog", href: "/dashboard/catalog", icon: "catalog", permissionKey: "catalog" },
      { label: "Inventory", href: "/dashboard/inventory", icon: "inv", permissionKey: "inventory" },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Settings", href: "/dashboard/settings", icon: "settings", permissionKey: "settings" },
      { label: "Features & Updates", href: "/dashboard/updates", icon: "updates", permissionKey: null },
    ],
  },
]

// The entries that are folders of teams with counts (TeamFolder)
const FOLDERS: Record<string, TeamFolderConfig> = {
  "/dashboard/tickets": TICKETS_FOLDER,
  "/dashboard/opportunities": OPPORTUNITIES_FOLDER,
}

// One sidebar row's look, shared with the team folders
export const NAV_ROW =
  "flex min-h-9 min-w-0 items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
export const navRowState = (active: boolean) =>
  active ? "bg-sb-active font-semibold text-sb-active-text" : "font-medium text-sb-text hover:bg-sb-hover"

// Sections stay highlighted on their nested routes (detail pages, new
// forms, quote templates). Matching on a "/" boundary keeps
// /dashboard/client-x from matching Clients, and Dashboard home only
// highlights on /dashboard itself.
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export interface SidebarProps {
  pagePermissions?: PagePermissions
  companyName: string
  logoUrl: string | null
  userName: string
}

// The app's sidebar (the design's dark, light, or tinted style, from the
// theme's --ps-sb-* colors): the company's logo and name, the pages in
// their sections, the Opportunities folder with its teams and counts, and
// the signed in user's button opening a menu with My settings and Log out. The same sidebar shows
// in the phone menu.
export function Sidebar({ pagePermissions = {}, companyName, logoUrl, userName }: SidebarProps) {
  const pathname = usePathname()
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.permissionKey === null || pagePermissions[item.permissionKey] === true),
  })).filter((section) => section.items.length > 0)

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 overflow-y-auto border-r border-sb-border bg-sb-bg px-3 py-4 text-sb-text">
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-1">
        <LogoTile logoUrl={logoUrl} companyName={companyName} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-bold tracking-[-0.01em]" title={companyName}>
            {companyName}
          </span>
          <span className="text-xs text-sb-muted">PSAsync</span>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.label} role="group" aria-labelledby={`nav-section-${section.label}`} className="flex flex-col gap-1">
          <p id={`nav-section-${section.label}`} className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sb-muted">
            {section.label}
          </p>
          {section.items.map((item) => {
            const active = isNavActive(item.href, pathname)
            // Tickets and Opportunities are folders of teams and members with
            // counts. Each reads its list's team and person from the URL, so
            // it sits in its own Suspense boundary, falling back to the
            // plain entry.
            const folder = FOLDERS[item.href]
            if (folder) {
              return (
                <Suspense key={item.href} fallback={<NavLink item={item} active={active} />}>
                  <TeamFolder config={folder} isActive={active} />
                </Suspense>
              )
            }
            return <NavLink key={item.href} item={item} active={active} />
          })}
        </div>
      ))}

      <div className="flex-1" />
      <UserMenu userName={userName} />
    </nav>
  )
}

// The company's uploaded logo on a white tile, or the PSAsync logo (no
// tile, in the sidebar's readable shade of the accent) when it has none or
// removed it
function LogoTile({ logoUrl, companyName }: { logoUrl: string | null; companyName: string }) {
  if (logoUrl) {
    return (
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-white p-0.5">
        {/* A public logo on the uploads bucket; next/image only serves /icon.png here */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={`${companyName} logo`} className="h-full w-full object-contain" />
      </span>
    )
  }
  return <PsasyncMark fill="sidebar" />
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cn(NAV_ROW, navRowState(active))}>
      <NavIcon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  )
}
