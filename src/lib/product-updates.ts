export type UpdateCategory = "New Feature" | "Improvement" | "Fix"

export const PSASYNC_OVERVIEW =
  "PSAsync is a unified PSA (Professional Services Automation) platform built for MSPs and IT resellers. It brings quoting, ticketing, accounting, and HR into one connected system — Quotes, Tickets, Accounting, and HR — so your team isn't juggling five disconnected tools to run the business."

export interface ProductUpdate {
  version: string
  date: string // YYYY-MM-DD
  title: string
  category: UpdateCategory
  description: string
}

// Newest first. Add a new entry here as part of the same branch/PR that
// ships the feature — merging to main deploys both together, so the
// update appears on /updates the moment the release goes live.
export const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    version: "v0.9.01",
    date: "2026-09-11",
    title: "Customizable Dashboard",
    category: "New Feature",
    description:
      "A new customizable Dashboard at the heart of PSAsync. Build your own dashboard or use the shared company Default, and arrange widgets on a real grid with drag and drop. Widgets include Assets by Status, Assets by Client, Open Quotes, Open Purchase Orders, and Total Clients, each linking straight into the underlying data. Styled with a live tile effect that adapts to your company's brand colors. This release also fixes company brand colors not applying immediately after login, they previously showed default fallback colors until a manual refresh.",
  },
  {
    version: "v0.8.37",
    date: "2026-09-09",
    title: "List View Polish",
    category: "Improvement",
    description:
      "Added a bit of breathing room to the left edge of the Sales Orders, Purchase Orders, and Quotes list tables so the first column's text isn't sitting flush against the table border, matching the spacing already used on Clients, Vendors, and Catalog.",
  },
  {
    version: "v0.8.36",
    date: "2026-09-09",
    title: "Inventory & Purchase Order Polish",
    category: "Improvement",
    description:
      "Status badges across every Inventory view are now color coded, green for in stock, blue for deployed, amber for pending offboard or in repair, gray for decommissioned, instead of plain text. The Re-deploy button got its own distinct styling to match the other asset actions. Checkout and Offboard's warehouse container pickers now go through the same company, then location, then container flow as Return to Stock, instead of a separate flattened list. Purchase Order line items now link each received serial number straight to its Inventory asset page.",
  },
  {
    version: "v0.8.35",
    date: "2026-09-09",
    title: "Standalone Inventory Section",
    category: "New Feature",
    description:
      "Inventory moved out of the Client Assets tab and into its own top level section. The new list page shows every asset company wide with filters for Status, Owner, Category, and Location, an Active/Inactive toggle that hides decommissioned assets by default, and a separate Stock tab for non-serialized pooled quantities with manual adjustment. Each asset now has a full detail page with all its fields, custom field values, file attachments, a complete audit trail, and a new Re-deploy action to reassign an already-deployed asset to a different person without a full return cycle. The Client Assets tab is now a simple read only list linking out to these new pages.",
  },
  {
    version: "v0.8.34",
    date: "2026-09-04",
    title: "Inventory Checkout, Return, Offboard, and Remove",
    category: "New Feature",
    description:
      "Added the full checkout lifecycle for Inventory assets: Sold (stocked in a container or deployed to a client contact), Loaned (with an expected return date), and Internal (assigned to a staff member). A shared Return to Stock flow routes Loaned and Sold returns through a Pending Offboard step, with Sold asking whether it's a refund, disposal, or the client just holding stock. Offboard finalizes that step, and Remove is available from any status with a required reason. The Client Assets tab now shows real holder state, including a Current User field.",
  },
  {
    version: "v0.8.33",
    date: "2026-09-03",
    title: "Client Assets Tab",
    category: "New Feature",
    description:
      "Added a two column Client Assets tab: a tree on the left grouping the client's assets by site and container, and a detail panel on the right for whichever asset is selected, covering status, serial number, category, owner, exact container path, warranty, custom field values, and notes.",
  },
  {
    version: "v0.8.32",
    date: "2026-09-02",
    title: "Client Inventory Onboarding and Container Setup",
    category: "New Feature",
    description:
      "Storage locations (Containers) now live under a client's specific sites instead of one flat company wide list, since your own company is really just another client record. Added a Client Settings tab with an Inventory onboarding flow that checks for an Asset Tag prefix before turning Inventory tracking on for that client, plus a star to set default container per site. Also fixed standalone Purchase Orders marked \"Ship to Client\" not actually saving a real link to the chosen client or location, which had been silently breaking receiving for those orders.",
  },
  {
    version: "v0.8.30",
    date: "2026-09-01",
    title: "Inventory Module Foundations",
    category: "New Feature",
    description:
      "Built out the data model behind Inventory: a company wide Category tree with per category custom fields, per client Asset Tag prefixes and sequence counters, warehouse storage locations, the core Asset and pooled Stock records, a full audit trail, document attachments, and per unit serial number tracking on Purchase Order receiving. Categories and Locations both got management screens in Settings, and Catalog Items gained a required Category plus a Serialized flag that's now actually exposed on the item form.",
  },
  {
    version: "v0.8.10",
    date: "2026-08-18",
    title: "Client Contact Tags",
    category: "New Feature",
    description:
      "Contacts can now be tagged (e.g. Sales Contact, Tech Contact) with a company managed tag list under Settings → Clients. Tags show as colored pills on the contact list alongside the Primary badge, and a contact can hold more than one.",
  },
  {
    version: "v0.8.15",
    date: "2026-08-18",
    title: "CSV Import & Export for Clients",
    category: "New Feature",
    description:
      "Added Export, Import, and Download Template buttons to the Clients list. Export offers a choice between just the currently filtered rows or every client, and Import validates and maps a CSV file's rows before creating them.",
  },
  {
    version: "v0.8.08",
    date: "2026-08-17",
    title: "Rebrand to PSAsync",
    category: "Improvement",
    description:
      "Rolled out the PSAsync brand across the entire product: the new purple accent color and app icon, every visible mention of the old PetaCore name replaced (login screen, sidebar, browser tab title, Settings, quote PDF footer, and more), and the old module nicknames (Kilobid, MegaTicket, NanoBooks, TeraTalent) replaced with their plain names (Quotes, Tickets, Accounting, HR).",
  },
  {
    version: "v0.8.05",
    date: "2026-08-13",
    title: "Catalog & Vendor Detail Pages",
    category: "New Feature",
    description:
      "Catalog Items and Vendors both got full tabbed detail pages matching Clients. Catalog Items now track Vendor SKU and Manufacturer SKU separately, show a real Order History and field level Change Log, and use a Billing Unit dropdown instead of free text. Vendors can now be tagged as any combination of Vendor, Manufacturer, and Distributor, gained a logo upload and a Documents tab, and Payment Terms is now a dropdown instead of free text on both. Also fixed a flickering login background.",
  },
  {
    version: "v0.8.02",
    date: "2026-08-13",
    title: "Distributor Search: D&H and Amazon Business",
    category: "New Feature",
    description:
      "D&H and Amazon Business are now live, real time distributor integrations in the quote builder's product search, alongside the existing ones. Added a filter to choose which distributors a search actually queries, with your last selection remembered across sessions.",
  },
  {
    version: "v0.7.13",
    date: "2026-08-05",
    title: "Purchase Order Fix and Design Consistency Pass",
    category: "Fix",
    description:
      "Fixed a race condition that could drop a Purchase Order line item's received checkbox back to unchecked. Also swept the Sales/Purchase Order work against the app's design rules and fixed several gaps: missing focus rings, inconsistent border radius on inline edit fields, and rebuilt the Attachments tab on both with proper drag and drop, upload progress, and a multi file queue.",
  },
  {
    version: "v0.7.11",
    date: "2026-08-05",
    title: "Sales & Purchase Order Overhaul",
    category: "New Feature",
    description:
      "Rebuilt Sales Orders and Purchase Orders from the ground up. Sales Orders can now be created manually without a Quote, with a tabbed detail page (Details, Internal Notes, Attachments) and a full line item builder supporting Catalog items, ad-hoc items, and Bundles. Purchase Orders gained manual creation with vendor selection, optional linking to a Sales Order, and a ship to client vs. ship to own location picker, on the same tabbed layout with the same line item builder.",
  },
  {
    version: "v0.7.08",
    date: "2026-08-04",
    title: "Client Portal Fixes and Payment Terms Carry-Through",
    category: "Fix",
    description:
      "Fixed several client portal issues: line item ordering not matching the quote editor, widespread unreadable text from a dark theme color leaking onto the portal's light background, Terms & Conditions rendering as raw HTML, and the company logo returning a broken image error. Added a Secondary Logo option for portal headers with a colored background. Payment Terms now carries through automatically from Client to Quote to Sales Order.",
  },
  {
    version: "v0.7.06",
    date: "2026-08-04",
    title: "Sales Order Creation and Visibility Fixes",
    category: "Fix",
    description:
      "Fixed Sales Orders silently failing to be created when a quote was approved, caused by a background task that could get cut off before finishing. The real underlying issue turned out to be a missing \"see all users' orders\" permission that no role had ever been given, now added to Roles & Permissions for both Sales and Purchase Orders. Also fixed layout overlap on the quote detail page at narrower screen widths.",
  },
  {
    version: "v0.7.03",
    date: "2026-07-30",
    title: "Quote Editor Improvements",
    category: "Improvement",
    description:
      "Fixed blank sections disappearing from Quotes and Templates on reload, and fixed the New Quote page's shipping address autofill, which had been silently broken. Terms & Conditions is now a rich text editor (bold, italic, lists) instead of a plain textarea, available on Quotes, Templates, and a company wide default, with a checkbox to use that default instead of custom terms.",
  },
  {
    version: "v0.7.00",
    date: "2026-07-30",
    title: "Client detail overhaul: Locations, Contacts, Industries",
    category: "New Feature",
    description:
      "Client pages now have a full set of tabs — Details, Locations, Contacts, and placeholders for Tickets, Opportunities, Assets, Contracts, Licenses & Subscriptions, Documents, and an Engagement Hub. Clients can have multiple physical locations, each with its own billing and shipping contact. Contacts now track work/cell phone, remote vs. in-office, and which location they're based at. Client industry is now a searchable, manageable list instead of free text, and the client name is editable.",
  },
  {
    version: "v0.6.02",
    date: "2026-07-29",
    title: "Features & Updates page",
    category: "New Feature",
    description:
      "A new page showing what's changed in PSAsync over time, with the most recent release spotlighted at the top. Click the PSAsync logo in the sidebar to view it.",
  },
  {
    version: "v0.6.01",
    date: "2026-07-29",
    title: "Custom branding, favicon, and dynamic tab title",
    category: "Improvement",
    description:
      "PSAsync now shows your company logo as the browser tab icon, and the tab title displays your company name. Also fixed the site's root URL, which was still showing a placeholder page.",
  },
  {
    version: "v0.6.00",
    date: "2026-07-29",
    title: "Full UI Overhaul",
    category: "New Feature",
    description:
      "A complete visual and interaction refresh across the entire platform — dark and light themes, a refined data table experience with sorting and adjustable density, toast notifications for every action, and themed confirmation dialogs replacing the browser's default popups.",
  },
]