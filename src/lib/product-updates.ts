export type UpdateCategory = "New Feature" | "Improvement" | "Fix"

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
    version: "v0.6.02",
    date: "2026-07-29",
    title: "Features & Updates page",
    category: "New Feature",
    description:
      "A new page showing what's changed in PetaCore over time, with the most recent release spotlighted at the top. Click the PetaCore logo in the sidebar to view it.",
  },
  {
    version: "v0.6.01",
    date: "2026-07-29",
    title: "Custom branding, favicon, and dynamic tab title",
    category: "Improvement",
    description:
      "PetaCore now shows your company logo as the browser tab icon, and the tab title displays your company name. Also fixed the site's root URL, which was still showing a placeholder page.",
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