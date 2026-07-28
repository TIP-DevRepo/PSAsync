"use client"

import { useState, useEffect, useLayoutEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, Building2, UserCog, FileText, Bell, Plug, ShieldCheck, Mail, ClipboardList } from "lucide-react"
import { cn } from "@/lib/utils"
import { CompanySettingsPanel } from "@/components/settings/CompanySettingsPanel"
import { UsersSettingsPanel } from "@/components/settings/UsersSettingsPanel"
import { RolesPermissionsPanel } from "@/components/settings/RolesPermissionsPanel"
import { QuoteSettingsPanel } from "@/components/settings/QuoteSettingsPanel"
import { ApprovalWorkflowsPanel } from "@/components/settings/ApprovalWorkflowsPanel"
import { NotificationSettingsPanel } from "@/components/settings/NotificationSettingsPanel"
import { DistributorSettingsPanel } from "@/components/settings/DistributorSettingsPanel"
import { MicrosoftSettingsPanel } from "@/components/settings/MicrosoftSettingsPanel"
import { SalesOrderSettingsPanel } from "@/components/settings/SalesOrderSettingsPanel"

type PanelKey =
  | "company"
  | "users"
  | "roles"
  | "salesOrders"
  | "quotes"
  | "approval-workflows"
  | "notifications"
  | "distributors"
  | "microsoft"

interface SettingsItem {
  key: PanelKey
  label: string
  icon: typeof Building2
}

interface SettingsCategory {
  label: string
  items: SettingsItem[]
}

const settingsCategories: SettingsCategory[] = [
  {
    label: "Company Settings",
    items: [{ key: "company", label: "Company Info & Branding", icon: Building2 }],
  },
  {
    label: "Users",
    items: [
      { key: "users", label: "Manage Users", icon: UserCog },
      { key: "roles", label: "Roles & Permissions", icon: ShieldCheck },
    ],
  },
  {
    label: "Quotes",
    items: [
      { key: "quotes", label: "Quote Settings", icon: FileText },
      { key: "approval-workflows", label: "Approval Workflows", icon: ShieldCheck },
    ],
  },
  {
    label: "Sales Orders",
    items: [{ key: "salesOrders", label: "Sales Order Settings", icon: ClipboardList }],
  },
  {
    label: "Notifications",
    items: [{ key: "notifications", label: "Notification Workflows", icon: Bell }],
  },
  {
    label: "Integrations",
    items: [
      { key: "distributors", label: "Distributor Integrations", icon: Plug },
      { key: "microsoft", label: "Microsoft / Outlook Integration", icon: Mail },
    ],
  },
]

// Flat lookup so the right-hand panel and its title are easy to resolve
// from whichever item key is currently selected
const ITEM_LOOKUP = {} as Record<PanelKey, { label: string; category: string }>
settingsCategories.forEach((cat) => {
  cat.items.forEach((item) => {
    ITEM_LOOKUP[item.key] = { label: item.label, category: cat.label }
  })
})

// Turns a category label into a safe id fragment for aria-controls/id pairing
function categoryPanelId(label: string) {
  return `settings-accordion-panel-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

function renderPanel(key: PanelKey | null) {
  switch (key) {
    case "company":
      return <CompanySettingsPanel />
    case "users":
      return <UsersSettingsPanel />
      case "roles":
      return <RolesPermissionsPanel />
    case "salesOrders":
      return <SalesOrderSettingsPanel />
    case "quotes":
      return <QuoteSettingsPanel />
    case "approval-workflows":
      return <ApprovalWorkflowsPanel />
    case "notifications":
      return <NotificationSettingsPanel />
    case "distributors":
      return <DistributorSettingsPanel />
    case "microsoft":
      return <MicrosoftSettingsPanel />
    default:
      return (
        <p className="text-sm text-zinc-500">
          Select a setting from the left to get started.
        </p>
      )
  }
}

export default function SettingsIndexPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading...</p>}>
      <SettingsPageContent />
    </Suspense>
  )
}

function SettingsPageContent() {
  const searchParams = useSearchParams()

  // Start with the first category open and its first item selected, so the
  // page never opens to a totally empty right-hand panel
  const [openCategory, setOpenCategory] = useState<string | null>(settingsCategories[0].label)
  const [selectedKey, setSelectedKey] = useState<PanelKey | null>(settingsCategories[0].items[0].key)

  // Deliberately single-open: these are unrelated settings categories (not
  // sequential steps or an FAQ), so only one is expanded at a time to keep
  // the left panel scannable.
  function toggleCategory(label: string) {
    const btn = headerRefs.current[label]
    if (btn) {
      scrollAnchor.current = { label, top: btn.getBoundingClientRect().top }
    }
    setOpenCategory((prev) => (prev === label ? null : label))
  }

  // If a ?panel= param is present (e.g. redirected here from the Microsoft
  // OAuth flow), open that panel's category and select it directly
  useEffect(() => {
    const panel = searchParams.get("panel") as PanelKey | null
    if (panel && ITEM_LOOKUP[panel]) {
      setOpenCategory(ITEM_LOOKUP[panel].category)
      setSelectedKey(panel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Anchor the tapped header: when a category expands/collapses and shifts
  // content below it, keep the header the user actually clicked pinned at
  // the same viewport position instead of letting the page jump.
  const headerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const scrollAnchor = useRef<{ label: string; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!scrollAnchor.current) return
    const { label, top } = scrollAnchor.current
    const btn = headerRefs.current[label]
    scrollAnchor.current = null
    if (!btn) return
    const newTop = btn.getBoundingClientRect().top
    const delta = newTop - top
    if (delta !== 0) window.scrollBy(0, delta)
  }, [openCategory])

  const selected = selectedKey ? ITEM_LOOKUP[selectedKey] : null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="flex gap-6 items-start">
        {/* Left panel — accordion */}
        <div className="w-72 flex-shrink-0 space-y-2">
          {settingsCategories.map((category) => {
            const isOpen = openCategory === category.label
            const panelId = categoryPanelId(category.label)
            return (
              <div key={category.label} className="rounded-md border">
                <button
                  ref={(el) => {
                    headerRefs.current[category.label] = el
                  }}
                  onClick={() => toggleCategory(category.label)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
                >
                  {category.label}
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform duration-300 ease-out", isOpen && "rotate-180")}
                  />
                </button>

                <div
                  id={panelId}
                  role="region"
                  aria-hidden={!isOpen}
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="border-t px-4 py-2 flex flex-col gap-1">
                      {category.items.map((item) => {
                        const ItemIcon = item.icon
                        const isSelected = selectedKey === item.key
                        return (
                          <button
                            key={item.key}
                            onClick={() => setSelectedKey(item.key)}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left",
                              isSelected
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            )}
                          >
                            <ItemIcon className="h-4 w-4" />
                            {item.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Right panel — selected setting's content */}
        <div className="flex-1 min-w-0 rounded-md border p-6">
          {selected && (
            <div className="mb-4">
              <p className="text-xs text-zinc-400">{selected.category}</p>
              <h2 className="text-lg font-semibold">{selected.label}</h2>
            </div>
          )}
          {renderPanel(selectedKey)}
        </div>
      </div>
    </div>
  )
}