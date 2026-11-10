import { test } from "node:test"
import assert from "node:assert/strict"
import {
  layerOrder,
  layoutFromResolved,
  normalizeSidebarLayout,
  orderTeams,
  PSASYNC_SIDEBAR_LAYOUT,
  resolveSidebarLayout,
  SIDEBAR_SECTIONS,
  visibleSidebarSections,
  type ResolvedSidebarLayout,
  type SidebarLayout,
} from "./sidebar-layout"
import { parseStoredSidebarLayout, readCompanySidebarPatch, readUserSidebarPatch } from "./sidebar-layout-schema"

// The sidebar layout resolution rules (src/lib/sidebar-layout.ts) and the
// zod schemas (src/lib/sidebar-layout-schema.ts). Run with npm test.

const itemKeys = (layout: ResolvedSidebarLayout, section: string) => layout.sections.find((s) => s.key === section)!.items.map((i) => i.key)
const defaultKeys = (section: string) => SIDEBAR_SECTIONS.find((s) => s.key === section)!.items.map((i) => i.key)

const ALL_PAGES = {
  clients: true,
  catalog: true,
  vendors: true,
  quotes: true,
  opportunities: true,
  tickets: true,
  settings: true,
  salesOrders: true,
  purchaseOrders: true,
  inventory: true,
}

// ─── Defaults ───────────────────────────────────────────────────────────────

test("no layouts: the PSAsync default", () => {
  const layout = resolveSidebarLayout({ company: null, user: null, allowUser: true })
  assert.deepEqual(itemKeys(layout, "work"), ["dashboard", "tickets", "opportunities"])
  assert.deepEqual(itemKeys(layout, "records"), defaultKeys("records"))
  assert.deepEqual(layout.folders.tickets, { teamOrder: [], openByDefault: false })
  assert.deepEqual(layout.defaultViews, { opportunities: "board", tickets: "open" })
  assert.deepEqual(layout, PSASYNC_SIDEBAR_LAYOUT)
})

// ─── User over company ──────────────────────────────────────────────────────

test("the company layout applies when the user has none", () => {
  const company: SidebarLayout = {
    sections: { work: ["opportunities", "dashboard", "tickets"] },
    folders: { tickets: { teamOrder: ["t2", "t1"], openByDefault: true } },
    defaultViews: { opportunities: "list", tickets: "mine" },
  }
  const layout = resolveSidebarLayout({ company, user: null, allowUser: true })
  assert.deepEqual(itemKeys(layout, "work"), ["opportunities", "dashboard", "tickets"])
  assert.deepEqual(layout.folders.tickets, { teamOrder: ["t2", "t1"], openByDefault: true })
  assert.deepEqual(layout.defaultViews, { opportunities: "list", tickets: "mine" })
})

test("the user's layout wins over the company's, part by part", () => {
  const company: SidebarLayout = {
    sections: { work: ["opportunities", "dashboard", "tickets"], sales: ["purchaseOrders", "quotes", "salesOrders"] },
    folders: { tickets: { teamOrder: ["t2", "t1"], openByDefault: true }, opportunities: { openByDefault: true } },
    defaultViews: { opportunities: "list", tickets: "mine" },
  }
  const user: SidebarLayout = {
    sections: { work: ["tickets", "opportunities", "dashboard"] },
    folders: { tickets: { teamOrder: ["t1"], openByDefault: false } },
    defaultViews: { tickets: "waiting" },
  }
  const layout = resolveSidebarLayout({ company, user, allowUser: true })
  assert.deepEqual(itemKeys(layout, "work"), ["tickets", "opportunities", "dashboard"])
  // A section the user didn't order follows the company
  assert.deepEqual(itemKeys(layout, "sales"), ["purchaseOrders", "quotes", "salesOrders"])
  // The user's teams first, then the company's order for the rest
  assert.deepEqual(layout.folders.tickets, { teamOrder: ["t1", "t2"], openByDefault: false })
  // A folder setting the user didn't make follows the company
  assert.equal(layout.folders.opportunities.openByDefault, true)
  assert.deepEqual(layout.defaultViews, { opportunities: "list", tickets: "waiting" })
})

test("a partial user order: unnamed pages keep the company's order", () => {
  const company: SidebarLayout = { sections: { records: ["inventory", "catalog", "vendors", "clients"] } }
  const user: SidebarLayout = { sections: { records: ["vendors"] } }
  const layout = resolveSidebarLayout({ company, user, allowUser: true })
  assert.deepEqual(itemKeys(layout, "records"), ["vendors", "inventory", "catalog", "clients"])
})

// ─── Company lock ───────────────────────────────────────────────────────────

test("company switch off: the user's layout is ignored", () => {
  const company: SidebarLayout = { sections: { work: ["opportunities", "dashboard", "tickets"] }, defaultViews: { tickets: "all" } }
  const user: SidebarLayout = {
    sections: { work: ["tickets", "dashboard", "opportunities"] },
    folders: { opportunities: { openByDefault: true } },
    defaultViews: { tickets: "mine", opportunities: "list" },
  }
  const layout = resolveSidebarLayout({ company, user, allowUser: false })
  assert.deepEqual(itemKeys(layout, "work"), ["opportunities", "dashboard", "tickets"])
  assert.equal(layout.folders.opportunities.openByDefault, false)
  assert.deepEqual(layout.defaultViews, { opportunities: "board", tickets: "all" })
})

test("company switch off and no company layout: the PSAsync default", () => {
  const user: SidebarLayout = { sections: { work: ["tickets", "dashboard", "opportunities"] } }
  assert.deepEqual(resolveSidebarLayout({ company: null, user, allowUser: false }), PSASYNC_SIDEBAR_LAYOUT)
})

// ─── Hidden items ───────────────────────────────────────────────────────────

test("pages the user can't see are never shown, whatever the order says", () => {
  const user: SidebarLayout = { sections: { work: ["opportunities", "tickets", "dashboard"], records: ["inventory", "clients"] } }
  const layout = resolveSidebarLayout({ company: null, user, allowUser: true })
  const sections = visibleSidebarSections(layout, { tickets: true, clients: true })
  const work = sections.find((s) => s.key === "work")!
  assert.deepEqual(
    work.items.map((i) => i.key),
    ["tickets", "dashboard"]
  )
  assert.deepEqual(
    sections.find((s) => s.key === "records")!.items.map((i) => i.key),
    ["clients"]
  )
  // Sales has nothing the user may see, so the section is gone
  assert.equal(
    sections.some((s) => s.key === "sales"),
    false
  )
})

test("every page shows for a user with every page", () => {
  const sections = visibleSidebarSections(PSASYNC_SIDEBAR_LAYOUT, ALL_PAGES)
  assert.deepEqual(
    sections.map((s) => s.items.length),
    SIDEBAR_SECTIONS.map((s) => s.items.length)
  )
})

test("teams the user can't see aren't added by a saved team order", () => {
  const teams = [{ id: "a" }, { id: "b" }]
  assert.deepEqual(
    orderTeams(teams, ["hidden", "b", "a"]).map((t) => t.id),
    ["b", "a"]
  )
})

// ─── New items ──────────────────────────────────────────────────────────────

test("a page missing from a saved order appears at the end of its section", () => {
  // As if "opportunities" were added in a later release than this layout
  const saved: SidebarLayout = { sections: { work: ["tickets", "dashboard"] } }
  const layout = resolveSidebarLayout({ company: saved, user: saved, allowUser: true })
  assert.deepEqual(itemKeys(layout, "work"), ["tickets", "dashboard", "opportunities"])
})

test("a team missing from a saved order follows in its own order", () => {
  const teams = [{ id: "general" }, { id: "helpdesk" }, { id: "new-team" }]
  assert.deepEqual(
    orderTeams(teams, ["helpdesk", "general"]).map((t) => t.id),
    ["helpdesk", "general", "new-team"]
  )
})

test("layerOrder: layer keys first, the rest in the base order", () => {
  assert.deepEqual(layerOrder(["a", "b", "c", "d"], ["c", "a"]), ["c", "a", "b", "d"])
  assert.deepEqual(layerOrder(["a", "b"], undefined), ["a", "b"])
  assert.deepEqual(layerOrder(["a", "b"], []), ["a", "b"])
})

// ─── Unknown keys ───────────────────────────────────────────────────────────

test("unknown and removed pages in a saved order are ignored", () => {
  const saved: SidebarLayout = { sections: { work: ["reports", "opportunities", "opportunities", "dashboard"], unknownSection: ["x"] } }
  const layout = resolveSidebarLayout({ company: saved, user: null, allowUser: true })
  assert.deepEqual(itemKeys(layout, "work"), ["opportunities", "dashboard", "tickets"])
  assert.deepEqual(
    layout.sections.map((s) => s.key),
    SIDEBAR_SECTIONS.map((s) => s.key)
  )
})

test("a page saved in another section stays in its own section", () => {
  const saved: SidebarLayout = { sections: { work: ["quotes", "tickets"] } }
  const layout = resolveSidebarLayout({ company: saved, user: null, allowUser: true })
  assert.deepEqual(itemKeys(layout, "work"), ["tickets", "dashboard", "opportunities"])
  assert.deepEqual(itemKeys(layout, "sales"), defaultKeys("sales"))
})

test("normalize drops unknown sections, pages, and repeats", () => {
  const out = normalizeSidebarLayout({
    sections: { work: ["reports", "tickets", "tickets"], made_up: ["dashboard"] },
    folders: { tickets: { teamOrder: ["a", "a", "b"] } },
  })
  assert.deepEqual(out, { sections: { work: ["tickets"] }, folders: { tickets: { teamOrder: ["a", "b"] } } })
})

test("stored layouts: unknown keys and bad parts are ignored, never thrown", () => {
  assert.equal(parseStoredSidebarLayout(null), null)
  assert.equal(parseStoredSidebarLayout("not a layout"), null)
  assert.equal(parseStoredSidebarLayout([1, 2]), null)
  const parsed = parseStoredSidebarLayout({
    version: 7,
    sections: { work: ["opportunities", 5, "removed-page"], records: "broken" },
    folders: { tickets: { teamOrder: ["a", null], openByDefault: "yes" }, wiki: { openByDefault: true } },
    defaultViews: { opportunities: "calendar", tickets: "mine" },
  })
  assert.deepEqual(parsed, {
    sections: { work: ["opportunities"], records: [] },
    folders: { tickets: { teamOrder: ["a"] } },
    defaultViews: { tickets: "mine" },
  })
  const layout = resolveSidebarLayout({ company: parsed, user: null, allowUser: true })
  assert.deepEqual(itemKeys(layout, "records"), defaultKeys("records"))
  assert.equal(layout.defaultViews.opportunities, "board")
})

// ─── Request validation ─────────────────────────────────────────────────────

test("requests: a valid layout is accepted and cleaned", () => {
  const res = readUserSidebarPatch({ layout: { sections: { work: ["tickets", "nope", "dashboard"] }, defaultViews: { opportunities: "list", tickets: "unassigned" } }, extra: true })
  assert.equal(res.error, undefined)
  assert.deepEqual(res.data, { layout: { sections: { work: ["tickets", "dashboard"] }, defaultViews: { opportunities: "list", tickets: "unassigned" } } })
})

test("requests: wrong types and unknown views are refused", () => {
  assert.ok(readUserSidebarPatch(null).error)
  assert.ok(readUserSidebarPatch({}).error)
  assert.ok(readUserSidebarPatch({ layout: "x" }).error)
  assert.ok(readUserSidebarPatch({ layout: { sections: { work: "tickets" } } }).error)
  assert.ok(readUserSidebarPatch({ layout: { folders: { tickets: { openByDefault: "yes" } } } }).error)
  assert.ok(readUserSidebarPatch({ layout: { folders: { tickets: { teamOrder: ["has spaces"] } } } }).error)
  assert.equal(readUserSidebarPatch({ layout: { defaultViews: { tickets: "everything" } } }).error, "Choose a default view from the list")
  assert.equal(readUserSidebarPatch({ layout: { defaultViews: { opportunities: "calendar" } } }).error, "Choose a default view from the list")
})

test("company requests: the switch must be a boolean, parts left out are kept", () => {
  assert.deepEqual(readCompanySidebarPatch({ allowUserSidebar: false }).data, { allowUserSidebar: false })
  assert.ok(readCompanySidebarPatch({ allowUserSidebar: "no" }).error)
  assert.deepEqual(readCompanySidebarPatch({}).data, {})
})

test("an editor round trip keeps the resolved layout", () => {
  const company: SidebarLayout = { sections: { admin: ["updates", "settings"] }, folders: { opportunities: { teamOrder: ["x"], openByDefault: true } }, defaultViews: { tickets: "all" } }
  const resolved = resolveSidebarLayout({ company, user: null, allowUser: true })
  const again = resolveSidebarLayout({ company: layoutFromResolved(resolved), user: null, allowUser: true })
  assert.deepEqual(again, resolved)
})
