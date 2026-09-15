# PSAsync Design Rules

Compiled from all 63 UX pattern breakdowns at [designmotionhq.com/patterns](https://designmotionhq.com/patterns) (free, public library). This is a standing reference for the PSAsync UI overhaul — organized by category so it's easy to pull up the right rules while working on a specific component.

**How to use this:** when building or redesigning a component, check the relevant section(s) below first. Each pattern includes a "PSAsync relevance" note where there's an obvious connection to something in our roadmap or existing code.

---

## Motion

### Animation Timing
- Entrances: 200–300ms, cubic ease-out.
- Exits: ~40% faster than their matching entrance (e.g. 250ms in / 150ms out).
- Tap/press feedback: under 100ms or it reads as lag.
- Attention-grabbing motion (notifications): 500–800ms with bounce/overshoot.
- Stagger list items ~50ms apart (30ms blurs together, 100ms crawls).
- Match easing to intent: ease-out for entrances; reserve springs/bounce for moments that need attention.

### Easing Curves
- Linear = mechanical/cheap — reserve for continuous motion (spinners), never start/stop UI.
- Ease-out = safest default for elements entering the screen.
- Spring/overshoot = alive/premium — good for button presses, modals, confirmations.
- Reuse the same handful of curves everywhere for a coherent feel.
- Stagger list/card entrances a few frames apart instead of one hard snap.

### Card Hover Anatomy
- Lift ~8px with a stretching shadow, ~200ms ease-out (faster = twitchy, slower = stuck).
- Claim the cursor: pulsing accent border or gradient sweep on hover.
- Cascade revealed actions ~60ms apart, anchored to the card's bottom.
- Scale the image ~1.05 inside an `overflow-hidden` frame — never scale the whole card (shifts neighbors, breaks grid).

### Scroll-Driven Animations
- `animation-timeline: scroll()` + `animation-range` — native CSS scroll-triggered animation, no JS/IntersectionObserver needed.
- `view()` targets individual elements as they enter the viewport.
- Combine with `position: sticky` for shrinking headers, progress bars, transforming sidebars.
- Don't hand-roll parallax with scroll listeners — CSS does it natively now.

---

## Visual

### Charts That Lie
- Bar chart y-axis always starts at zero — never truncate to exaggerate differences.
- Match chart type to the question: bars = compare, lines = change over time, pie falls apart past ~5 slices.
- Balance aspect ratio so the average slope reads honestly (~45°).
- Maximize data-ink ratio — strip gridlines/shadows/3D/boxed legends.
- One accent color to spotlight the series that matters.
- Title with the takeaway, not the metric ("Revenue flat since March," not "Quarterly revenue").
- **PSAsync relevance:** any future dashboard/reporting charts.

### Design System Kit
- Semantic tokens (`var(--brand)`, `var(--error)`) over hardcoded hex — survives redesigns, one rename updates everywhere.
- Numbered color scale (100–900) mapped to semantic names.
- Real type scale — same size/weight everywhere = no hierarchy.
- 4px spacing scale (4 → 64) — random gaps (7px, 23px) read as sloppy.
- Standardize components as variants/sizes/states (primary/secondary/ghost/destructive; sm/md/lg; default/focus/error/disabled).
- Match motion to intent: ease-out to enter, ease-in-out to move, ease-in to exit.
- **PSAsync relevance:** foundational for the full UI overhaul pass — do this before/alongside the HeroUI conversion.

### Golden Ratio
- Spacing scale via ×1.618: 8 → 13 → 21 → 34 → 55.
- Layout splits at ~62%/38% — primary content gets the larger panel.
- Type scale by the same factor (16 / 26 / 42 / 68).
- Round to clean pixel values; don't fight your existing 8px grid.

### Grid System
- 12-column grid as the base (divides cleanly into halves/thirds/quarters/sixths).
- Common ratios: 4:8 (sidebar+content), 6:6 (even split), 3:9 (narrow nav+canvas).
- Gutters set mood: 8px dense/technical, 24px balanced, 40px editorial/premium.
- Responsive column drop: 12 → 6 → 4 → 1 across breakpoints.
- Break the grid on purpose (full-bleed hero, margin pull-quote) only once it's established.

### Proximity Rule
- Elements close together read as one group — spacing alone can group UI, no borders needed.
- Gap within a group < gap between groups.
- Forms: tighten related fields (~12px), open section breaks (~40px).
- Group toolbar/nav controls by function (navigate / actions / system), not evenly spaced.
- **PSAsync relevance:** Settings accordion, quote line item groupings.

### Shadow Elevation
- Real depth = stacked shadows (tight contact ~0 1px 3px + mid-distance + wide soft spread), not one blur.
- Subtle colored glow (low-opacity accent hue) reads premium/branded.
- Match glow color to product context.
- Elevation = hierarchy signal — more elevated reads more important.

### Visual Hierarchy
- Primary element ~2x body text size.
- One accent color reserved for the single most important action; keep everything else neutral.
- Contrast separates roles (bold heading vs muted body; filled primary vs ghost secondary).
- Whitespace is a signal — give the hero element room, keep secondary items compact.
- Font weight builds reading order without changing size (800 heading / 400 body / 300 caption).
- Stack size + color + contrast + whitespace + weight together — no single rule carries a layout alone.

### Z-Index Mastery
- `z-index` does nothing without `position: relative/absolute/fixed/sticky` first.
- Every stacking context is its own universe — a child can never climb above its parent's siblings, no matter the number.
- `z-index: 9999` arms races are a symptom of an unexpected stacking context up the tree, not a fix.
- `isolation: isolate` creates a clean, contained stacking context in one line.
- Use Chrome DevTools' Layers panel to inspect the real 3D stack.
- **PSAsync relevance:** possibly relevant to the queued tooltip no-show bug — worth checking for stacking-context issues.

### Gradient Design
- Stay within 60° of hue travel (neighboring hues blend clean; opposites create muddy gray).
- Keep lightness moving in one direction — reversing direction reads as banding.
- Gradients work best as ambiance (soft radial glow behind content), not a full-bleed surface wash.
- Add 2–3% noise/grain to hide banding on cheap displays.
- Never put body text directly on a gradient's mid-transition zone.

### Icon Design Rules
- Optical sizing: circular/organic shapes need to sit 5–8% larger than squares to read as the same size.
- Snap to a 24px grid (16px for dense UI) to keep edges crisp.
- One stroke weight (2px) across the entire set — mixed weights look like mashed-together libraries.
- Fixed bounding box even as shapes change, for even toolbar sizing.
- Fill vs. outline is a set-wide commitment, not per-icon.
- **PSAsync relevance:** you use `lucide-react` — check consistency of weight/size across the app.

### Design Tokens
- Name by meaning/role (`color-primary`, `spacing-md`), not literal value (`color-blue-500`) — survives a rebrand.
- Three layers: primitives → semantic → component, each referencing the layer above.
- One primitive change cascades everywhere it's referenced.
- Snap arbitrary spacing/font sizes onto a fixed scale.
- Dark mode = swapping token sets, not inverting colors.
- **PSAsync relevance:** directly ties to Design System Kit above — foundational for the UI overhaul.

### Color Accessibility
- WCAG thresholds: 4.5:1 body text, 3:1 large text.
- Most failures hide in "decorative" muted grays (nav links, card labels) sitting at 1.5–2:1.
- Never encode meaning with color alone (~8% of users have color vision deficiency) — pair with icon/label/pattern.
- Check every text/background pair; lighten/darken muted text until it clears the threshold.

### Gestalt Laws
- Closure: eye completes incomplete shapes — icons/outlines still read with gaps.
- Similarity: shared property (color/shape/size) reads as one group.
- Continuity: eye follows the smoothest path — align on a shared axis.
- Figure-Ground: dimming/blurring background pushes a modal forward as the focal point.
- Common Region: shared border/container groups elements even when spaced apart.

### Border Radius
- Nested corners: inner radius = outer radius − padding, for concentric alignment.
- One radius scale (4 · 8 · 12 · 16 · 24) reused everywhere.
- Scale radius with element size: tooltip ~4px, input ~8px, card ~12px, modal ~16px, panel ~24px.
- Small/sharp reads corporate; large/round reads friendly — match your brand tone.

### Dark Mode
- Base on near-black (#121212), not pure #000000, so shadows/depth stay visible.
- Layered surfaces: base → surface → elevated, each a lighter grey step.
- Desaturate accent colors ~20% — full saturation vibrates on dark backgrounds.
- Never pure white text (#FFFFFF glares) — calibrate to soft off-white.
- Build text hierarchy with opacity tiers, not new colors.
- **PSAsync relevance:** your Settings page already has `dark:` Tailwind classes — worth auditing against these rules specifically.

### Von Restorff Effect
- What's visually different gets noticed — isolate the one item you want chosen against a uniform baseline.
- Pricing: isolate the target plan (scale up, "Most Popular" badge, dim alternatives).
- One highlighted element per view — competing emphasis cancels the effect.
- Combine scale + elevation + glow, not color alone (color-blind safe).

### Perfect Card
- Padding 12px → 40px + 24px radius = instantly reads as intentional vs. cheap.
- Type hierarchy: 600 weight/~38px title, body dropped to ~55% opacity.
- Stack two shadows (tight dark + wide soft) for believable depth.
- Hairline border ~12% opacity to define edges on dark backgrounds.
- Hover: lift ~8px, scale 1.02, deepen shadow.

### Depth Layers
- Three properties create depth without redesigning: layered shadows, parallax scroll (1x/2.5x/5x speeds), z-translation on hover.
- Layered shadows: tight (~2px) + mid (~12px) + large ambient (~32px).
- Keep hover lift subtle (a few px + ~3% scale) — too much reads cartoonish.

---

## Forms

### Date Pickers
- Presets (Today/Yesterday/Last 7 days/Last 30 days/Last quarter) cover ~90% of cases; custom range for the rest.
- Hover paints a live preview; first click locks start, second locks end; edges stay draggable.
- Show two months side-by-side (three on large screens) so ranges can cross month boundaries.
- Full keyboard support: arrows, typing, Enter, Escape, Page Up (month), Shift+Page Up (year).
- Mobile: full-screen sheet, not a shrunk popover — today anchored top, confirm button in thumb reach.
- **PSAsync relevance:** quote expiry dates, SO/PO dates.

### Form Field States
- Six explicit states: default, focus, error, success, disabled, loading.
- Label outside the field + helper text below — never placeholder-as-label.
- Focus ring at least 3:1 contrast.
- Errors: color + icon + message together (border-only red fails for ~12% of users).
- Confirm success inside the field, not via toast.
- Disabled (grayscale + not-allowed cursor) visually distinct from loading (in-field spinner, blocks input).

### Input Masking
- Group long numbers in fixed chunks (e.g. 4-digit groups) for readability.
- Detect type from leading pattern (e.g. card brand) and show inline.
- Keep the caret right after the just-typed character when auto-inserting separators.
- Validate on blur, not keystroke.
- Reformat pasted values instead of rejecting them.
- Show formatted, store raw (no separators in the persisted value).

### Range Sliders
- Fill the track — the fill length is the value, readable at a glance.
- Expand the drag target to the full row, not a 4px hairline.
- Snap to steps with visible ticks when clean values matter.
- Float the value in a tooltip above the thumb while dragging.
- Two-thumb range: filled band between handles; full keyboard support (arrows, Home/End).

### Stepper Wizard
- Chunk long forms into steps grouped by context (Personal/Shipping/Payment/Review), not arbitrary field count.
- Always show progress (bar, dots, or labels).
- Validate inside each step — block Next while invalid, don't surface step-1 errors on step 4.
- Prefer inline errors over final-screen rejection.
- Persist state across Back/refresh.
- **PSAsync relevance:** directly matches your queued client onboarding/offboarding stepper component.

### Toggle Anatomy
- Rail = 2x knob diameter; knob padded by its own radius.
- Morph, don't snap — ~250ms ease-out flip.
- Rail color, knob position, knob shadow, and label all move together.
- Space toggles when focused; visible focus ring; `aria-checked` for screen readers.
- Async: optimistic flip + in-knob spinner + rollback (shake + error toast) on failure.

### Form Validation Timing
- On-submit = too late (wall of errors); every-keystroke = too early (flags mid-typing).
- Sweet spot: validate on blur.
- After a field errors once, switch to live validation so it clears the instant it's fixed.
- Green check for success, not just red for failure.

### File Upload UX
- Upload is a system of states: drag feedback, honest progress, error recovery, preview, queue.
- Dropzone answers on drag-over: border + glow + copy shift, before the drop.
- Show percent complete + time remaining, not just a spinner.
- Inline retry on failure — never force re-selection.
- Show thumbnail/type/size as proof of the right file.
- Multi-file queue: each item gets its own progress and retry.
- **PSAsync relevance:** your S3 logo upload flow in Company & Branding settings.

### Password Field UX
- Strength = entropy, not a checkbox tally — length beats mandatory symbols.
- Show requirements checklist live as they type, ticking green.
- Live strength meter, not post-submit punishment.
- Eye toggle to unmask.
- Never block paste (password managers).
- Offer a one-tap generated password.

### OTP Input
- Treat paste as primary: strip non-digits, distribute across all boxes at once.
- Auto-advance focus; backspace on empty box jumps back and clears.
- Model as one string, not N independent values.
- `inputmode="numeric"` + `autocomplete="one-time-code"` for mobile SMS autofill.
- Throttle resend behind a visible 30s countdown.
- Wrong code: shake + clear + refocus. Correct: green check per box.

---

## Feedback

### Toast Notifications
- Position bottom-right desktop, top edge mobile — never screen center.
- Dismiss timing by severity: routine ~4s, warnings ~7s, critical stays until acknowledged.
- Cap stack at 3 visible; newest enters bottom, older float up/out, rest queue.
- Close button + swipe-to-dismiss + pause-on-hover.
- Color-code by type but pair with icon + accent border (never color alone).

### Doherty Threshold
- 400ms is the threshold — under 200ms feels instant, 200–400ms tolerable, over 400ms breaks engagement.
- What matters is *perceived* speed, not raw speed.
- Skeleton loading for instant paint; optimistic UI for reversible actions; progress feedback for unavoidable waits.

### Error States
- Match error type to surface: inline for validation, banner/toast for connection issues, modal for blocking failures.
- Let severity drive intrusiveness.
- Every error needs an exit (Retry, support link, expandable details) — never a dead-end "OK."
- Plain-language copy — say what broke, why, and what to do next.
- Prevent before they happen: live inline validation with rules turning green as met.

### Loading States System
- Match pattern to what you know: known shape → skeleton (>300ms wait), unknown short wait → spinner (<3s), known percentage → progress bar (>3s).
- Optimistic UI for reversible actions — update instantly, reconcile in background.
- Under ~300ms: show nothing — a flash reads as a glitch, not feedback.

### Notification System
- Four surfaces: toast, banner, modal, badge — trigger severity picks the surface.
- Persistence differs by surface: toasts auto-dismiss with undo, banners stay until cleared, modals block, badges sit quietly.
- Toasts can stack; modals must never queue on top of each other.
- Over-escalating (routing everything to the loudest surface) trains users to tune out.

### Zeigarnik Effect
- Unfinished tasks stay in active memory; completed ones get dropped.
- Progress meters stuck at 80% (or an unchecked onboarding box) create return pressure.
- Only works for outcomes the user actually wants — fake progress bars have no pull.

### Undo UX
- Undo beats confirmation dialogs — act instantly, offer a time-limited undo instead of "Are you sure?"
- Soft delete: deleted flag + trash retention window, then purge — deletion is a state, not an event.
- Reserve heavy friction (type-to-confirm) only for genuinely irreversible actions.
- Show a visible countdown on the undo toast.

### Optimistic UI
- Update instantly, sync with server in background — under 400ms reads as instant.
- Roll back cleanly on failure.
- Reserve for reversible, low-stakes actions (likes, toggles, reorders) — never payments/transfers.

### Skeleton Loading
- Preview the shape of incoming content (avatar circle, text bars, image block) so the brain starts parsing early.
- Animated shimmer, not static — static reads as "broken."
- Match real content dimensions — a layout jump on load is worse than a spinner.
- Skip loading entirely for actions the user just performed (post, like) — render optimistically.

---

## Interaction

### Drag and Drop
- Confirm pickup with three cues together: scale-up, deeper shadow, slight tilt.
- Reveal the drop zone before release, not after.
- Insertion line to slot between items; filled highlight to land inside a whole column/group.
- Snap to nearest valid slot on structured surfaces; expose valid target slots while dragging.
- Pair every drop with a short undo toast (~5s).
- **PSAsync relevance:** directly informs the queued line item builder CSS Grid rewrite — the pickup/drop-zone/undo rules apply to our reorder feature.

### Dropdown Design
- 48px touch target, visible caret, real hover state on the trigger.
- Flip upward when there's no room below.
- Full keyboard support (arrows, Enter, Esc).
- Add search once a list passes ~10 items.
- Open animation ~150ms.

### Peak-End Rule
- Recall keys on the peak moment and the ending, not the average.
- Engineer at least one intentional peak (surprise, delight) in a flow.
- End on a high note — a flat/cold confirmation loses to a celebratory one for the same effort.
- Audit the final step of every flow; it weighs heaviest in memory.

### Search Experience System
- Descriptive placeholder ("Search by name, SKU, or brand"), not bare "Search."
- Surface recent searches on focus.
- Rank autocomplete by clicks, not alphabet; tag with category badges.
- Fully keyboard-driven with visible focus ring.
- Zero-result screens offer recovery (popular searches, category jumps), never a dead end.
- **PSAsync relevance:** the `ContactSearchInput` component and distributor search — worth auditing against this.

### Star Rating
- Preview fill ahead of the cursor on hover.
- Snap back to committed value when pointer leaves without clicking.
- Fractional fill for averages (4.4 = four full + a 44%-filled fifth) — never round up.
- Stagger fill ~30ms per star on commit.

### Tooltip Design
- ~300ms delay before showing, so it doesn't fire on accidental grazes.
- Point at the trigger with an arrow.
- Flip to the opposite side near viewport edges.
- Dismissible via mouse leave, Escape, blur, and tap-outside.
- Keep copy tight (~300px width, one sentence).
- **PSAsync relevance:** directly relevant to your logged tooltip no-show bug — check delay timing, dismiss handling, and (per Z-Index Mastery above) stacking context.

### Swipe Actions
- Invisible without an affordance hint (peek on first scroll, onboarding nudge).
- Destructive swipes need friction — reveal on partial swipe, require a tap or full-swipe + undo.
- Color-code by consequence, consistent across every list.
- Always provide a non-swipe fallback for discoverability/accessibility.

### Bottom Sheets
- Anchor menus/actions to the bottom (thumb-reach zone), not top-right.
- Keeps the underlying page visible, unlike a full modal.
- Snap points for half-open/full-height.
- Drag-to-dismiss.
- Scrim + locked body scroll while open.

### Color Picker UX
- Offer OKLCH alongside hex for predictable shade changes.
- Recent swatches + saved palettes.
- Live contrast ratio badge at pick time, not after.
- Preview alpha over a checkerboard on both light and dark backgrounds.
- Generate tints/shades from one hue.
- **PSAsync relevance:** Company & Branding color settings.

### Command Palette
- Fuzzy matching, not exact substring ("stg" should still find "Settings").
- Group results into labeled sections (Recent, Actions, Pages).
- Fully keyboard-driven.
- Prefill recent/suggested commands — never open to a blank void.
- Async commands: inline spinner, palette stays open.
- Support nested commands with breadcrumb + single-level Esc.

### Filter Chips
- Three distinct states: idle, active (filled + check), disabled (dimmed).
- OR within a group, AND across groups — keep the logic legible.
- Update result count on the same frame as the tap.
- Single clear-all reset with a live count.
- One horizontal scrolling row with edge fade — never wrap to multiple rows.
- Sticky summary bar pinning active filters.
- **PSAsync relevance:** Quotes/Clients list filters.

### Accordion Disclosure
- Can't animate `height: auto` — use `display: grid` with `grid-template-rows` (0fr → 1fr) or measured `scrollHeight`.
- Chevron rotation driven by the same timing curve as the panel.
- Decide single-open (sequential steps) vs. multi-open (FAQ) deliberately.
- Header is a real `<button>` with `aria-expanded`/`aria-controls`.
- Anchor the tapped header so the list doesn't jump when a lower item expands.
- **PSAsync relevance:** your Settings page accordion — worth checking against these rules directly.

### Data Table
- Sort is tri-state (asc → desc → original), not a binary toggle.
- Right-align numeric columns with tabular figures.
- Sticky header on vertical scroll, frozen first column on horizontal scroll.
- Row density as one token-driven control (36/48/60px), not per-table guessing.
- Whole row as the selection target, not just a tiny checkbox.
- Select-all morphs empty → indeterminate → checked.
- **PSAsync relevance:** Quotes list, Clients list, and the line item builder table itself.

### Modal Hierarchy
- First question: does it block the user? Yes → modal; no → sheet/popover/drawer by context.
- Modal: full scrim, single decision, reserved for critical/destructive choices.
- Bottom sheet: mobile-first default, drag handle, snap points, page stays partly visible.
- Drawer: edge-anchored, for navigation, dims only its own area.
- Popover: anchored to trigger, small (~200px), lightweight menus only.
- **PSAsync relevance:** your shared `Modal` component — audit whether every current use case actually needs full-modal weight vs. a lighter popover/drawer.

---

## Navigation

### Navigation Patterns
- Bottom tabs (3–5 items) for mobile — hamburger-only drops engagement ~40%.
- Persistent sidebar for desktop with 5+ hierarchical sections.
- Hamburger is secondary nav, never primary (desktop hamburger drops engagement ~56%).
- Command palette (⌘K) as a power-user accelerator, paired with visible nav.
- Breadcrumbs only earn their space past 2 levels of hierarchy.
- **PSAsync relevance:** directly informs your queued Breadcrumbs + Gooey Nav item — confirms breadcrumbs are worth it given PSAsync's nested structure (Settings → category → item; Quote → line items).

### Tabs System
- Active indicator slides (spring), never teleports; timing matches content fade.
- Overflowing tabs scroll horizontally with edge fades + desktop chevrons — never wrap.
- Full keyboard support (arrows, Home, End, Tab-out).
- Focus ring and active-state color must be visually distinct.
- Content fades out, pauses ~80ms, fades in on switch — never hard-cuts.
- Mobile: segmented control under 5 tabs, bottom sheet over 5 — never a shrunk desktop bar.
- **PSAsync relevance:** your Quotes/Templates/Settings tab UI.

### Focus States
- `outline: none` without a replacement is an accessibility failure.
- Real focus ring: 2px thick, 2px offset, sufficient contrast on any background.
- `:focus-visible` shows a ring for keyboard, not mouse clicks.
- Focus follows DOM order — keep visual and DOM order in sync.
- Modal focus trap: Tab cycles and wraps inside; Escape closes and returns focus to the trigger.
- Skip link as the first focusable element, hidden until focused.

### Pagination
- Offset pagination drifts when data changes (duplicates/skips); cursor pagination stays stable.
- Numbered = jump to any page; load-more = on-demand append; infinite scroll = continuous feed — pick per job.
- Truncate page links to first/last/current/neighbors with ellipsis.
- Keep page number in the URL for shareable/refreshable state.
- Restore scroll position on return from a detail view.
- **PSAsync relevance:** Quotes/Clients lists as data volume grows.

---

## Content

### Empty States
- One small illustration/icon signals "intentional," not broken.
- Warm, human copy over corporate error-speak.
- Every empty state needs a primary CTA pointing to the actual next step.
- Four kinds of empty (first run, no results, error, filtered-out) each need their own copy/CTA.
- Best onboarding moment — a ghost preview can teach the feature.

### Serial Position
- Recall is U-shaped: people remember first (primacy) and last (recency), forget the middle.
- Treat first/last slots as bookends for your highest-value content.
- Navbars: logo leads (primacy), primary CTA closes (recency).
- Landing pages: strongest USP first, strongest proof last.

### Microcopy
- Button labels name the reward ("Create my free account"), not the mechanic ("Submit").
- Turn errors into help ("That email's taken — want to log in?").
- Empty states are onboarding, not dead ends.
- Placeholder text is not a label — keep a persistent label above the input.
- Write like a helpful colleague, not a log file.

### Landing Page Skeleton
- Fixed 5-section order: Hero, Proof, Problem, Solution, CTA.
- Hero answers what/who/why in ~3 seconds.
- Social proof directly below the hero, not buried at the bottom.
- Agitate the problem before pitching the solution.
- Cap benefits at three, framed as outcomes not features.
- Repeat the exact same CTA (copy + color) at top and bottom.
- *(Lower relevance to PSAsync internally — most useful if we ever build a public marketing page.)*

---

## Quick-reference: patterns tied to logged PSAsync roadmap items

- **Line item builder CSS Grid rewrite** → Drag and Drop, Data Table, Card Hover Anatomy
- **Tooltip intermittent no-show bug** → Tooltip Design, Z-Index Mastery
- **Client onboarding/offboarding stepper (Phase 2+)** → Stepper Wizard
- **Breadcrumbs + Gooey Nav** → Navigation Patterns
- **Full UI overhaul / HeroUI conversion pass** → Design System Kit, Design Tokens, Golden Ratio, Grid System (do these first — everything else builds on them)
- **Settings accordion** → Accordion Disclosure, Proximity Rule
- **Quotes/Templates tabs** → Tabs System
- **Company & Branding logo upload** → File Upload UX
- **Company & Branding color picker** → Color Picker UX, Color Accessibility
- **Quotes/Clients list filters** → Filter Chips, Data Table, Pagination
- **Shared Modal component audit** → Modal Hierarchy
- **Dark mode classes already in Settings page** → Dark Mode

---

*Source: [designmotionhq.com/patterns](https://designmotionhq.com/patterns) — free to read, no license required. Compiled for internal reference only.*
