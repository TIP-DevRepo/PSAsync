"use client"

import { useState, useRef, useEffect, useContext, createContext, forwardRef, Fragment } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@heroui/react"
import { Repeat, ToggleRight, SlidersHorizontal, GitBranch, Package, AlignLeft, GripVertical, ImageOff, Check, AlertTriangle } from "lucide-react"
import { useFixedMenuPosition, useCloseOnOutsideClick, useCloseOnScroll } from "@/lib/useFixedMenu"
import { Modal } from "@/components/Modal"
import { confirmDialog } from "@/lib/confirm-dialog"
import { promptDialog } from "@/lib/prompt-dialog"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type Active,
  type Over,
} from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import type { DraggableAttributes } from "@dnd-kit/core"
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities"
import { DistributorProductGroup, DistributorOffer, DistributorKey } from "@/lib/distributors/types"

// A dedicated id for the "No items in bundle" placeholder row shown when
// a bundle is empty — its own droppable target so an item can still be
// dragged into an otherwise-empty bundle.
function emptyBundlePlaceholderId(bundleName: string) {
  return `__empty_bundle__${bundleName}`
}

function sectionCapId(sectionKey: string, edge: "top" | "bottom") {
  return `__section_${edge}__${sectionKey}`
}

// Custom collision detection: since this is a single vertical list, only
// the pointer's Y position matters — NOT which narrow column of a row
// it happens to be over. Every row's droppable rect is measured from just
// one cell (the drag handle), so a normal x/y-aware algorithm would only
// register a hit when the cursor is precisely over that narrow column.
// This checks every droppable's vertical band (top→bottom) regardless of
// x, so hovering ANYWHERE across the full width of a row counts as being
// "over" that row — which is what makes the insertion line track smoothly
// no matter where in the row the cursor actually is.
const verticalBandCollision: CollisionDetection = (args) => {
  const { droppableRects, droppableContainers, pointerCoordinates } = args
  if (!pointerCoordinates) return []

  let topMost: { id: (typeof droppableContainers)[number]["id"]; top: number } | null = null
  let bottomMost: { id: (typeof droppableContainers)[number]["id"]; bottom: number } | null = null
  let best: { id: (typeof droppableContainers)[number]["id"]; distance: number } | null = null

  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id)
    if (!rect) continue

    if (pointerCoordinates.y >= rect.top && pointerCoordinates.y <= rect.bottom) {
      return [{ id: container.id }]
    }

    if (!topMost || rect.top < topMost.top) topMost = { id: container.id, top: rect.top }
    if (!bottomMost || rect.bottom > bottomMost.bottom) bottomMost = { id: container.id, bottom: rect.bottom }

    const center = (rect.top + rect.bottom) / 2
    const distance = Math.abs(pointerCoordinates.y - center)
    if (!best || distance < best.distance) {
      best = { id: container.id, distance }
    }
  }

  // Above every row → explicitly the topmost row. Below every row →
  // explicitly the bottommost row. This guarantees the insertion line is
  // always visible at the very top/bottom of the list, instead of relying
  // on distance comparison to happen to land there.
  if (topMost && pointerCoordinates.y < topMost.top) return [{ id: topMost.id }]
  if (bottomMost && pointerCoordinates.y > bottomMost.bottom) return [{ id: bottomMost.id }]

  return best ? [{ id: best.id }] : []
}

// ─── Shared Types ─────────────────────────────────────────────────────────
export type RecurringInterval = "MONTHLY" | "QUARTERLY" | "ANNUALLY"

export interface LineItemBuilderItem {
  id: string
  catalogItemId: string | null
  section: string | null
  sortOrder: number
  name: string
  description: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  cost: number
  discount: number
  taxable: boolean
  isRecurring: boolean
  recurringInterval: RecurringInterval | null
  isOptional: boolean
  quantityAdjustable: boolean
  choiceGroup: string | null
  isTextBlock: boolean
  bundleName: string | null
  bundleDisplayMode: string | null
  isBundleHeader: boolean
}

export interface CatalogOption {
  id: string
  name: string
  sku: string | null
  msrp: number
  cost: number
  taxable: boolean
  active: boolean
}

const NO_SECTION = "__no_section__"

// ─── Data Table density control ────────────────────────────────────────
// Sort and whole-row-select don't apply to this table (order is
// drag-controlled data, and every cell is an editable input) — density
// is the one Data Table rule that maps cleanly here.
type Density = "compact" | "default" | "comfortable"

const ROW_PADDING: Record<Density, string> = {
  compact: "py-1",
  default: "py-2",
  comfortable: "py-3",
}

function lineTotal(li: LineItemBuilderItem) {
  return li.unitPrice * li.quantity * (1 - li.discount / 100)
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

function getRowAccent(li: LineItemBuilderItem) {
  if (li.isTextBlock) return "border-l-4 border-zinc-300 dark:border-zinc-600"
  if (li.bundleName) return "border-l-4 border-purple-400"
  if (li.choiceGroup) return "border-l-4 border-amber-400"
  if (li.isRecurring) return "border-l-4 border-teal-400"
  if (li.isOptional) return "border-l-4 border-blue-300"
  return "border-l-4 border-transparent"
}

function marginColor(marginPct: number) {
  if (marginPct >= 20) return "text-green-600"
  if (marginPct < 10) return "text-red-500"
  return "text-zinc-500"
}

function marginModifierPct(li: LineItemBuilderItem) {
  if (li.cost <= 0 || li.unitPrice <= 0) return 0
  return ((li.unitPrice - li.cost) / li.unitPrice) * 100
}

function isBundleChild(li: LineItemBuilderItem) {
  return !!li.bundleName && !li.isBundleHeader
}

// ─── CSS Grid table plumbing ────────────────────────────────────────────
// The whole line item table is ONE css grid. Every cell (header or body) is
// a direct child of that grid — there is no wrapping <tr>-equivalent DOM
// element, because a wrapping element would break grid item placement.
// Each "row" is represented by a React Context that feeds live style info
// down to whichever Cells are rendered inside it.
const GRID_COLS =
  "3.5rem 3.5rem 6rem minmax(11rem,1fr) 4rem 5rem 4.5rem 5.5rem 4rem 5.5rem 4.5rem 6rem"

interface RowStyle {
  opacity: number
  rowClassName: string
}

const defaultRowStyle: RowStyle = {
  opacity: 1,
  rowClassName: "",
}

const RowStyleContext = createContext<RowStyle>(defaultRowStyle)

interface CellProps {
  span?: number
  className?: string
  children?: React.ReactNode
}

const Cell = forwardRef<HTMLDivElement, CellProps>(function Cell({ span, className, children }, ref) {
  const row = useContext(RowStyleContext)
  return (
    <div
      ref={ref}
      className={`${row.rowClassName} ${className ?? ""}`}
      style={{
        gridColumn: span ? `span ${span} / span ${span}` : undefined,
        opacity: row.opacity,
      }}
    >
      {children}
    </div>
  )
})

// A thin full-width highlight showing exactly where a dragged item will
// land — rendered in-flow right before or after the row currently being
// hovered. Nothing else moves or shifts while dragging; this is the only
// thing that changes until the item is actually dropped.
function InsertionLine() {
  return (
    <div
      style={{ gridColumn: "1 / -1", animation: "insertion-fade-in 100ms ease-out" }}
      className="my-0.5 h-1 rounded-full bg-blue-500"
    />
  )
}

// Shown in place of a bundle's child list when it has no items yet — also
// a real droppable target, so a bundle doesn't need at least one item
// already inside it before you can drag something in.
function EmptyBundlePlaceholder({ bundleName }: { bundleName: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: emptyBundlePlaceholderId(bundleName) })
  return (
    <div
      ref={setNodeRef}
      style={{ gridColumn: "1 / -1" }}
      className={`mx-4 my-1 rounded border border-dashed py-2 text-center text-xs ${
        isOver ? "border-purple-400 bg-purple-50 text-purple-600 dark:bg-purple-950/30" : "border-zinc-300 text-zinc-400"
      }`}
    >
      No items in bundle — drop here to add one
    </div>
  )
}

// Always-present drop targets at the very top and bottom of a section's
// item list — not computed from neighboring rows' rects, so there's no
// edge-of-list math that can drift out of sync. Invisible when idle,
// shown as a thin insertion line the moment they're hovered.
function SectionEdgeCap({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} style={{ gridColumn: "1 / -1" }} className="h-2">
      {isOver && <div className="h-1 rounded-full bg-blue-500" />}
    </div>
  )
}

// Small persistent config indicators — always rendered for every regular
// line item, dimmed by default and lit up when that config is actually on,
// so the full set of possible flags is visible at a glance without opening
// the kebab menu.
function LineItemConfigIcons({ li }: { li: LineItemBuilderItem }) {
  const configs: { key: string; active: boolean; label: string; Icon: typeof Repeat; activeColor: string }[] = [
    { key: "recurring", active: li.isRecurring, label: "Recurring", Icon: Repeat, activeColor: "text-teal-500" },
    { key: "optional", active: li.isOptional, label: "Optional", Icon: ToggleRight, activeColor: "text-blue-500" },
    {
      key: "qtyAdjustable",
      active: li.quantityAdjustable,
      label: "Qty adjustable in portal",
      Icon: SlidersHorizontal,
      activeColor: "text-rose-500",
    },
    { key: "choiceGroup", active: !!li.choiceGroup, label: "Choice group", Icon: GitBranch, activeColor: "text-amber-500" },
    { key: "bundle", active: !!li.bundleName, label: "In a bundle", Icon: Package, activeColor: "text-purple-500" },
  ]

  return (
    <div className="grid grid-flow-col grid-rows-3 gap-1 w-fit">
      {configs.map(({ key, active, label, Icon, activeColor }) => (
        <Tooltip key={key} delay={150} closeDelay={0}>
          <Tooltip.Trigger>
            <span className={active ? activeColor : "text-zinc-300 dark:text-zinc-700"}>
              <Icon size={13} />
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content>{label}</Tooltip.Content>
        </Tooltip>
      ))}
    </div>
  )
}

// Provides dnd-kit sortable behavior for one logical "row." Renders no DOM
// element of its own — it's a Context provider that feeds live style info
// to whichever Cells are rendered as its children via the render-prop.
// The FIRST Cell rendered inside must forward `drag.rowRef` so dnd-kit has
// a real, measurable grid item to track for this row's position/height.
// Rows themselves never move during a drag — only their opacity dims while
// being dragged. Where the item WOULD land is shown separately via a
// floating DragOverlay preview and an InsertionLine, not by shifting rows.
function SortableRow({
  id,
  disabled,
  className,
  isDropTarget,
  children,
}: {
  id: string
  disabled: boolean
  className?: string
  isDropTarget?: boolean
  children: (drag: {
    attributes: DraggableAttributes
    listeners: SyntheticListenerMap | undefined
    isDragging: boolean
    rowRef: (node: HTMLElement | null) => void
  }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id, disabled })
  const dropTargetClass = isDropTarget ? "ring-2 ring-inset ring-purple-500 bg-purple-100 dark:bg-purple-900/40" : ""

  const rowStyle: RowStyle = {
    opacity: isDragging ? 0.4 : 1,
    rowClassName: `${className ?? ""} ${dropTargetClass}`.trim(),
  }

  return (
    <RowStyleContext.Provider value={rowStyle}>
      {children({ attributes, listeners, isDragging, rowRef: setNodeRef })}
    </RowStyleContext.Provider>
  )
}

function DragHandle({
  attributes,
  listeners,
  disabled,
}: {
  attributes: DraggableAttributes
  listeners: SyntheticListenerMap | undefined
  disabled: boolean
}) {
  if (disabled) return <span className="inline-block w-4" />
  return (
    <button
      {...attributes}
      {...listeners}
      type="button"
      title="Drag to reorder"
      className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 touch-none"
    >
      <GripVertical size={18} />
    </button>
  )
}

// Every row splits cleanly at its own vertical midpoint: hovering the top
// half means "insert above this row," the bottom half means "insert below
// this row." That's it — no separate "join" band. The only way to join a
// bundle is by hovering one of its existing line items directly (handled
// in handleDragEnd below); bundle headers behave exactly like any other
// top-level row.
type DropZone = "above" | "below"

function getDropZone(active: Active, over: Over): DropZone {
  const activeRect = active.rect.current.translated ?? active.rect.current.initial
  if (!activeRect || !over.rect) return "above"
  const activeCenterY = activeRect.top + activeRect.height / 2
  const relativeY = (activeCenterY - over.rect.top) / over.rect.height
  return relativeY < 0.5 ? "above" : "below"
}

// Given a new top-level order (headers, text blocks, unbundled items —
// no children), rebuilds the FULL section order by inserting each
// bundle's children directly after its header. This is what actually
// keeps a bundle's items glued to it — not just in this component's
// rendering (which already groups them visually regardless of stored
// order), but in the real sortOrder values saved to the database, which
// is what anything else reading this quote's line items relies on.
function renumberSectionWithBundles(
  sectionOrderedItems: LineItemBuilderItem[],
  newTopLevelOrder: LineItemBuilderItem[],
  // The item currently being moved must NEVER be pulled back in here from
  // stale pre-drag data — if it just left a bundle, the old data still
  // shows it as that bundle's child, which would silently re-add it as a
  // second, conflicting update racing against its real new position.
  excludeFromChildrenId?: string
): LineItemBuilderItem[] {
  const finalOrder: LineItemBuilderItem[] = []
  for (const li of newTopLevelOrder) {
    finalOrder.push(li)
    if (li.isBundleHeader) {
      const children = sectionOrderedItems
        .filter(
          (c) => isBundleChild(c) && c.bundleName === li.bundleName && c.id !== excludeFromChildrenId
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
      finalOrder.push(...children)
    }
  }
  return finalOrder
}

// Removes movedId from the list, then reinserts it directly above or below
// overId — used for every plain reordering case below.
function reorderList<T extends { id: string }>(
  list: T[],
  movedId: string,
  overId: string,
  zone: "above" | "below"
): T[] {
  const movedItem = list.find((i) => i.id === movedId)
  const without = list.filter((i) => i.id !== movedId)
  if (!movedItem) return list
  const overIdx = without.findIndex((i) => i.id === overId)
  if (overIdx === -1) return list
  const insertIdx = zone === "below" ? overIdx + 1 : overIdx
  return [...without.slice(0, insertIdx), movedItem, ...without.slice(insertIdx)]
}

// ─── Main Component ─────────────────────────────────────────────────────
interface LineItemBuilderProps {
  items: LineItemBuilderItem[]
  catalog: CatalogOption[]
  locked?: boolean
  onCreate: (section: string | null, payload: Partial<LineItemBuilderItem>) => void | Promise<void>
  onUpdate: (id: string, patch: Partial<LineItemBuilderItem>) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onMove: (section: string | null, itemId: string, direction: "up" | "down") => void | Promise<void>
  onDuplicate: (li: LineItemBuilderItem) => void | Promise<void>
}

export function LineItemBuilder({
  items,
  catalog,
  locked = false,
  onCreate,
  onUpdate,
  onDelete,
  onMove,
  onDuplicate,
}: LineItemBuilderProps) {
  const [pendingSections, setPendingSections] = useState<string[]>([])
  const [addModalSection, setAddModalSection] = useState<string | null>(null)
  const [addToBundleName, setAddToBundleName] = useState<string | null>(null)
  const [newSectionName, setNewSectionName] = useState("")
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null)
  const { menuRef: rowMenuRef, style: menuStyle } = useFixedMenuPosition(!!openRowMenu, menuAnchor)
  const [density, setDensity] = useState<Density>("default")
  const pad = ROW_PADDING[density]
  // Which item is currently being dragged (drives the floating DragOverlay
  // preview), and where it would land if dropped right now (drives the
  // InsertionLine / bundle-join ring). Rows themselves never move.
  const [activeDragItem, setActiveDragItem] = useState<LineItemBuilderItem | null>(null)
  const [dragIndicator, setDragIndicator] = useState<{ overId: string; zone: DropZone } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useCloseOnOutsideClick(!!openRowMenu, [rowMenuRef], () => {
    setOpenRowMenu(null)
    setMenuAnchor(null)
  })

  useCloseOnScroll(!!openRowMenu, () => {
    setOpenRowMenu(null)
    setMenuAnchor(null)
  })

  function handleOpenRowMenu(e: React.MouseEvent<HTMLButtonElement>, itemId: string) {
    if (openRowMenu === itemId) {
      setOpenRowMenu(null)
      setMenuAnchor(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right })
    setOpenRowMenu(itemId)
  }

  async function handleAddChoiceGroup(section: string | null) {
    const groupName = await promptDialog({
      title: "Name this choice group",
      placeholder: 'e.g. "Support Tier"',
    })
    if (!groupName) return
    const name = groupName.trim()
    await onCreate(section, { name: "Option 1", isOptional: true, choiceGroup: name })
    await onCreate(section, { name: "Option 2", isOptional: true, choiceGroup: name })
  }

  async function handleAddBundle(section: string | null) {
    const bundleName = await promptDialog({
      title: "Name this bundle",
      placeholder: 'e.g. "Starter Kit"',
    })
    if (!bundleName) return
    const name = bundleName.trim()
    await onCreate(section, { name, bundleName: name, isBundleHeader: true })
  }

  function openAddItemToBundle(section: string | null, bundleName: string) {
    setAddToBundleName(bundleName)
    setAddModalSection(section === null ? NO_SECTION : section)
  }

  async function handleAddTextBlock(section: string | null) {
    await onCreate(section, {
      name: "Section heading",
      description: "Add your text here...",
      unitPrice: 0,
      cost: 0,
      isTextBlock: true,
    })
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmDialog({
      title: "Remove this line item?",
      confirmLabel: "Remove",
      variant: "danger",
    })
    if (!confirmed) return
    await onDelete(id)
  }

  function handleDragStart(event: DragStartEvent, sectionOrderedItems: LineItemBuilderItem[]) {
    const item = sectionOrderedItems.find((i) => i.id === event.active.id)
    setActiveDragItem(item ?? null)
  }

  // Computes ONLY where the insertion indicator should show — nothing
  // moves, nothing shifts.
  function handleDragOver(event: DragOverEvent, sectionOrderedItems: LineItemBuilderItem[]) {
    const { active, over } = event
    if (!over || over.id === active.id) {
      setDragIndicator(null)
      return
    }
    if (String(over.id).startsWith("__empty_bundle__")) {
      setDragIndicator({ overId: String(over.id), zone: "below" })
      return
    }
    if (String(over.id).startsWith("__section_")) {
      setDragIndicator(null)
      return
    }
    const overItem = sectionOrderedItems.find((i) => i.id === over.id)
    if (!overItem) {
      setDragIndicator(null)
      return
    }
    setDragIndicator({ overId: overItem.id, zone: getDropZone(active, over) })
  }

  async function handleDragEnd(event: DragEndEvent, sectionOrderedItems: LineItemBuilderItem[]) {
    setDragIndicator(null)
    setActiveDragItem(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const movedItem = sectionOrderedItems.find((i) => i.id === active.id)

    if (String(over.id).startsWith("__empty_bundle__")) {
      const targetBundleName = String(over.id).replace("__empty_bundle__", "")
      if (movedItem) {
        await onUpdate(movedItem.id, { sortOrder: 0, bundleName: targetBundleName })
      }
      return
    }

    if (String(over.id).startsWith("__section_top__") || String(over.id).startsWith("__section_bottom__")) {
      if (!movedItem) return
      const isTop = String(over.id).startsWith("__section_top__")
      // A bundle header's bundleName is its own identity, not "which
      // bundle it's a member of" — it must never be cleared. Only clear
      // bundleName when a regular item (currently inside some bundle) is
      // being moved to the top level.
      const movedForInsert = movedItem.isBundleHeader ? movedItem : { ...movedItem, bundleName: null }
      const topLevelItems = sectionOrderedItems.filter((li) => !isBundleChild(li) && li.id !== movedItem.id)
      const reorderedTopLevel = isTop
        ? [movedForInsert, ...topLevelItems]
        : [...topLevelItems, movedForInsert]
      const finalOrder = renumberSectionWithBundles(sectionOrderedItems, reorderedTopLevel, movedItem.id)
      await Promise.all(
        finalOrder.map((li, idx) => {
          const patch: Partial<LineItemBuilderItem> = { sortOrder: idx }
          if (li.id === movedItem.id && !movedItem.isBundleHeader) patch.bundleName = null
          return onUpdate(li.id, patch)
        })
      )
      return
    }
    const overItem = sectionOrderedItems.find((i) => i.id === over.id)
    if (!movedItem || !overItem) return

    const zone = getDropZone(active, over)

    // ─── Case A: reordering within the SAME bundle — only its siblings move.
    // Must check that overItem is actually a CHILD (not the header) — a
    // header's bundleName holds the same value as its children's, so
    // without this check, hovering your own bundle's header would
    // incorrectly match here too. ──
    if (isBundleChild(movedItem) && isBundleChild(overItem) && overItem.bundleName === movedItem.bundleName) {
      const siblings = sectionOrderedItems.filter(
        (li) => li.bundleName === movedItem.bundleName && !li.isBundleHeader
      )
      const reordered = reorderList(siblings, movedItem.id, overItem.id, zone)
      await Promise.all(reordered.map((li, idx) => onUpdate(li.id, { sortOrder: idx })))
      return
    }

    // ─── Case B: a bundle header or text block — always top-level reordering.
    // For a bundle header specifically, its children move along with it —
    // renumbered to sit directly after wherever the header lands. ──
    if (movedItem.isBundleHeader || movedItem.isTextBlock) {
      const topLevelItems = sectionOrderedItems.filter((li) => !isBundleChild(li))
      const overTopLevelItem = isBundleChild(overItem)
        ? sectionOrderedItems.find((i) => i.isBundleHeader && i.bundleName === overItem.bundleName)
        : overItem
      if (!overTopLevelItem) return
      const reorderedTopLevel = reorderList(topLevelItems, movedItem.id, overTopLevelItem.id, zone)
      const finalOrder = renumberSectionWithBundles(sectionOrderedItems, reorderedTopLevel, movedItem.id)
      await Promise.all(finalOrder.map((li, idx) => onUpdate(li.id, { sortOrder: idx })))
      return
    }

    // ─── Case C: a regular item ──
    // Hovering one of a bundle's own child rows is the ONLY way to join
    // that bundle — positioned exactly relative to the child hovered.
    // Hovering the bundle's header itself no longer joins anything; it's
    // treated as a plain top-level row like everything else below.
    if (isBundleChild(overItem)) {
      const targetBundleName = overItem.bundleName
      if (targetBundleName) {
        const allChildren = sectionOrderedItems.filter(
          (li) => li.bundleName === targetBundleName && !li.isBundleHeader
        )
        const isLastChild = allChildren[allChildren.length - 1]?.id === overItem.id
        // Below the LAST item specifically means "leaving the bundle" —
        // fall through to the plain top-level insertion below instead of
        // joining. Every other position (including above the last item)
        // still joins normally.
        if (!(isLastChild && zone === "below")) {
          const siblings = allChildren.filter((li) => li.id !== movedItem.id)
          const overIdx = siblings.findIndex((i) => i.id === overItem.id)
          const insertIdx = zone === "above" ? overIdx : overIdx + 1
          const newSiblings = [
            ...siblings.slice(0, insertIdx),
            { ...movedItem, bundleName: targetBundleName },
            ...siblings.slice(insertIdx),
          ]
          await Promise.all(
            newSiblings.map((li, idx) =>
              onUpdate(li.id, { sortOrder: idx, ...(li.id === movedItem.id ? { bundleName: targetBundleName } : {}) })
            )
          )
          return
        }
      }
    }

    // Sub-case: hovering a bundle's header specifically. The header's
    // upper half means "insert before this whole bundle" (not bundled).
    // The header's lower half means "join this bundle, at the very top" —
    // combined with hovering any child joining at that child's position,
    // this makes the entire span from the header's lower edge down through
    // the bottom of the last item a continuous "add to bundle" zone, with
    // nothing dead in between.
    if (overItem.isBundleHeader && zone === "below") {
      const targetBundleName = overItem.bundleName
      if (targetBundleName) {
        const siblings = sectionOrderedItems.filter(
          (li) => li.bundleName === targetBundleName && !li.isBundleHeader && li.id !== movedItem.id
        )
        const newSiblings = [{ ...movedItem, bundleName: targetBundleName }, ...siblings]
        await Promise.all(
          newSiblings.map((li, idx) =>
            onUpdate(li.id, { sortOrder: idx, ...(li.id === movedItem.id ? { bundleName: targetBundleName } : {}) })
          )
        )
        return
      }
    }

    // Plain top-level insertion — above or below whatever was hovered,
    // including bundle headers, which behave like any other row here
    const topLevelItems = sectionOrderedItems.filter((li) => !isBundleChild(li) && li.id !== movedItem.id)
    const overTopLevelItem = isBundleChild(overItem)
      ? sectionOrderedItems.find((i) => i.isBundleHeader && i.bundleName === overItem.bundleName)
      : overItem
    if (!overTopLevelItem) return
    const overIdx = topLevelItems.findIndex((i) => i.id === overTopLevelItem.id)
    const insertIdx = zone === "below" ? overIdx + 1 : overIdx
    const reorderedTopLevel = [
      ...topLevelItems.slice(0, insertIdx),
      { ...movedItem, bundleName: null },
      ...topLevelItems.slice(insertIdx),
    ]
    const finalOrder = renumberSectionWithBundles(sectionOrderedItems, reorderedTopLevel, movedItem.id)
    await Promise.all(
      finalOrder.map((li, idx) => {
        const patch: Partial<LineItemBuilderItem> = { sortOrder: idx }
        if (li.id === movedItem.id) patch.bundleName = null
        return onUpdate(li.id, patch)
      })
    )
  }

  // ─── Derive section groups ────────────────────────────────────────────
  const realSections: string[] = []
  items
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((li) => {
      const key = li.section ?? NO_SECTION
      if (!realSections.includes(key)) realSections.push(key)
    })
  const sectionKeys = [...realSections, ...pendingSections].filter(
    (v, i, arr) => arr.indexOf(v) === i
  )
  if (sectionKeys.length === 0) sectionKeys.push(NO_SECTION)

  const existingChoiceGroups = Array.from(
    new Set(items.map((li) => li.choiceGroup).filter((v): v is string => !!v))
  )
  const existingBundleNames = Array.from(
    new Set(
      items
        .filter((li) => li.isBundleHeader)
        .map((li) => li.bundleName)
        .filter((v): v is string => !!v)
    )
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Repeat size={13} className="text-teal-500" /> recurring
          </span>
          <span className="flex items-center gap-1">
            <GitBranch size={13} className="text-amber-500" /> choice group
          </span>
          <span className="flex items-center gap-1">
            <Package size={13} className="text-purple-500" /> bundle
          </span>
          <span className="flex items-center gap-1">
            <ToggleRight size={13} className="text-blue-500" /> optional
          </span>
          <span className="flex items-center gap-1">
            <SlidersHorizontal size={13} className="text-rose-500" /> qty adjustable
          </span>
          <span className="flex items-center gap-1">
            <AlignLeft size={13} className="text-zinc-400" /> text block
          </span>
        </div>
        <select
          value={density}
          onChange={(e) => setDensity(e.target.value as Density)}
          className="rounded-md border px-2 py-1 text-xs"
        >
          <option value="compact">Compact rows</option>
          <option value="default">Default rows</option>
          <option value="comfortable">Comfortable rows</option>
        </select>
      </div>

      <fieldset disabled={locked} className="space-y-4 border-0 p-0 m-0">
        {sectionKeys.map((sectionKey) => {
          const sectionItems = items
            .filter((li) => (li.section ?? NO_SECTION) === sectionKey)
            .sort((a, b) => a.sortOrder - b.sortOrder)
          const sectionValue = sectionKey === NO_SECTION ? null : sectionKey

          return (
            <div key={sectionKey} className="rounded-md border overflow-hidden">
              <div className="flex items-center justify-between bg-zinc-50 px-4 py-2 dark:bg-zinc-900">
                <h3 className="font-medium text-sm">
                  {sectionKey === NO_SECTION ? "No Section" : sectionKey}
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAddModalSection(sectionKey)}>
                    + Add Line Item
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAddChoiceGroup(sectionValue)}>
                    + Choice Group
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAddBundle(sectionValue)}>
                    + Bundle
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAddTextBlock(sectionValue)}>
                    + Text Block
                  </Button>
                </div>
              </div>

              {sectionItems.length === 0 && (
                <p className="px-4 py-3 text-sm text-zinc-500">No items in this section yet.</p>
              )}

              {sectionItems.length > 0 && (() => {
                const bundleChildIds = new Set<string>()
                sectionItems.forEach((li) => {
                  if (li.isBundleHeader) {
                    sectionItems
                      .filter((x) => x.bundleName === li.bundleName && !x.isBundleHeader)
                      .forEach((c) => bundleChildIds.add(c.id))
                  }
                })

                // orderedItems (header, then its children right after) is only
                // used as the lookup source for the drag handlers below — it
                // never drives rendering directly anymore.
                const orderedItems: LineItemBuilderItem[] = []
                const topLevelItems: LineItemBuilderItem[] = []
                sectionItems.forEach((li) => {
                  if (bundleChildIds.has(li.id)) return
                  topLevelItems.push(li)
                  orderedItems.push(li)
                  if (li.isBundleHeader) {
                    sectionItems
                      .filter((x) => x.bundleName === li.bundleName && !x.isBundleHeader)
                      .forEach((c) => orderedItems.push(c))
                  }
                })

                function renderRow(li: LineItemBuilderItem, indent: boolean) {
                  const total = lineTotal(li)
                  const margin = total - li.cost * li.quantity
                  const marginPct = total > 0 ? (margin / total) * 100 : 0

                  if (li.isBundleHeader) {
                    return (
                      <SortableRow
                        id={li.id}
                        disabled={locked}
                        className="border-b bg-purple-50 dark:bg-purple-950/30"
                      >
                        {(drag) => (
                          <>
                            <Cell ref={drag.rowRef} className={`${pad} pl-4 ${getRowAccent(li)}`}>
                              <DragHandle attributes={drag.attributes} listeners={drag.listeners} disabled={locked} />
                            </Cell>
                            <Cell />
                            <Cell span={9} className={`${pad} pr-4`}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-purple-600 dark:text-purple-300">
                                  📦 BUNDLE
                                </span>
                                <input
                                  type="text"
                                  defaultValue={li.name}
                                  onBlur={(e) => onUpdate(li.id, { name: e.target.value })}
                                  className="flex-1 min-w-[10rem] rounded border px-2 py-1 text-sm font-semibold"
                                />
                                <select
                                  value={li.bundleDisplayMode ?? "COLLAPSED"}
                                  onChange={(e) => onUpdate(li.id, { bundleDisplayMode: e.target.value })}
                                  className="rounded border px-1 py-0.5 text-xs"
                                >
                                  <option value="COLLAPSED">Client sees: combined price</option>
                                  <option value="ITEMIZED">Client sees: itemized</option>
                                </select>
                                <button
                                  onClick={() => openAddItemToBundle(li.section ?? null, li.bundleName ?? "")}
                                  className="text-xs text-purple-600 hover:underline whitespace-nowrap"
                                >
                                  + Add Item to Bundle
                                </button>
                              </div>
                            </Cell>
                            <Cell className={`${pad} pr-4`}>
                              <button
                                onClick={() => handleDelete(li.id)}
                                title="Delete bundle (items inside stay)"
                                className="text-xs text-red-400 hover:text-red-700"
                              >
                                ✕
                              </button>
                            </Cell>
                          </>
                        )}
                      </SortableRow>
                    )
                  }

                  if (li.isTextBlock) {
                    return (
                      <SortableRow id={li.id} disabled={locked} className="border-b">
                        {(drag) => (
                          <>
                            <Cell ref={drag.rowRef} className={`${pad} pl-4 align-top ${getRowAccent(li)}`}>
                              <DragHandle attributes={drag.attributes} listeners={drag.listeners} disabled={locked} />
                            </Cell>
                            <Cell className="align-top" />
                            <Cell span={9} className={`${pad} pr-4 align-top`}>
                              <input
                                type="text"
                                defaultValue={li.name}
                                onBlur={(e) => onUpdate(li.id, { name: e.target.value })}
                                className="w-full rounded border px-2 py-1 text-sm font-semibold"
                              />
                              <textarea
                                defaultValue={li.description ?? ""}
                                placeholder="Body text (shown to the client)..."
                                onBlur={(e) => onUpdate(li.id, { description: e.target.value })}
                                rows={2}
                                className="mt-1 w-full rounded border px-2 py-1 text-xs text-zinc-500"
                              />
                            </Cell>
                            <Cell className={`${pad} pr-4 align-top`}>
                              <button
                                onClick={() => handleDelete(li.id)}
                                title="Delete"
                                className="text-xs text-red-400 hover:text-red-700"
                              >
                                ✕
                              </button>
                            </Cell>
                          </>
                        )}
                      </SortableRow>
                    )
                  }

                  return (
                    <SortableRow
                      id={li.id}
                      disabled={locked}
                      className="border-b"
                    >
                      {(drag) => (
                        <>
                          <Cell ref={drag.rowRef} className={`${pad} pl-4 align-top ${getRowAccent(li)}`}>
                            <span style={{ marginLeft: indent ? "1.25rem" : 0, display: "inline-block" }}>
                              <DragHandle attributes={drag.attributes} listeners={drag.listeners} disabled={locked} />
                            </span>
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top`}>
                            <LineItemConfigIcons li={li} />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top`}>
                            <input
                              type="text"
                              defaultValue={li.sku ?? ""}
                              onBlur={(e) => onUpdate(li.id, { sku: e.target.value })}
                              className="w-24 rounded border px-2 py-1 text-xs"
                            />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top`}>
                            {li.bundleName && (
                              <p className="text-xs text-purple-500 mb-1">
                                📦 in {li.bundleName}
                              </p>
                            )}
                            <input
                              type="text"
                              defaultValue={li.name}
                              onBlur={(e) => onUpdate(li.id, { name: e.target.value })}
                              className="w-full min-w-[10rem] rounded border px-2 py-1 text-xs font-medium"
                            />
                            <input
                              type="text"
                              defaultValue={li.description ?? ""}
                              placeholder="Description"
                              onBlur={(e) => onUpdate(li.id, { description: e.target.value })}
                              className="mt-1 w-full min-w-[10rem] rounded border px-2 py-1 text-xs text-zinc-500"
                            />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top text-right`}>
                            <input
                              type="number"
                              defaultValue={li.quantity}
                              onBlur={(e) => onUpdate(li.id, { quantity: Number(e.target.value) })}
                              className="w-16 rounded border px-2 py-1 text-xs text-right tabular-nums"
                            />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top text-right`}>
                            <input
                              key={`cost-${li.id}-${li.cost}`}
                              type="number"
                              step="0.01"
                              defaultValue={li.cost}
                              onBlur={(e) => onUpdate(li.id, { cost: Number(e.target.value) })}
                              className="w-20 rounded border px-2 py-1 text-xs text-right tabular-nums"
                            />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top text-right`}>
                            <input
                              key={`mod-${li.id}-${li.cost}-${li.unitPrice}`}
                              type="number"
                              step="0.1"
                              defaultValue={marginModifierPct(li).toFixed(1)}
                              onBlur={(e) => {
                                const mod = Number(e.target.value)
                                if (!Number.isFinite(mod) || mod >= 100) return
                                const newPrice = Math.round((li.cost / (1 - mod / 100)) * 100) / 100
                                onUpdate(li.id, { unitPrice: newPrice })
                              }}
                              className="w-16 rounded border px-2 py-1 text-xs text-right tabular-nums"
                            />
                            <span className="text-zinc-400"> %</span>
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top text-right`}>
                            <input
                              key={`price-${li.id}-${li.unitPrice}`}
                              type="number"
                              step="0.01"
                              max={99999999.99}
                              defaultValue={li.unitPrice}
                              onBlur={(e) => {
                                const value = Number(e.target.value)
                                const clamped = Math.min(value, 99999999.99)
                                onUpdate(li.id, { unitPrice: clamped })
                                if (clamped !== value) e.target.value = String(clamped)
                              }}
                              className="w-20 rounded border px-2 py-1 text-xs text-right tabular-nums"
                            />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top text-right`}>
                            <input
                              type="number"
                              step="1"
                              defaultValue={li.discount}
                              onBlur={(e) => onUpdate(li.id, { discount: Number(e.target.value) })}
                              className="w-16 rounded border px-2 py-1 text-xs text-right tabular-nums"
                            />
                          </Cell>
                          <Cell className={`${pad} pr-2 align-top font-medium text-right tabular-nums`}>{money(total)}</Cell>
                          <Cell className={`${pad} pr-2 align-top text-xs text-right tabular-nums`}>
                            {money(margin)}
                            <br />
                            <span className={marginColor(marginPct)}>
                              {total > 0 ? `${marginPct.toFixed(0)}%` : "—"}
                            </span>
                          </Cell>
                          <Cell className={`${pad} pr-4 align-top`}>
                            <div className="flex items-center gap-2 relative">
                              <button
                                onClick={() => onDuplicate(li)}
                                title="Duplicate"
                                className="text-xs text-zinc-400 hover:text-zinc-900"
                              >
                                ⧉
                              </button>
                              <button
                                onClick={() => handleDelete(li.id)}
                                title="Delete"
                                className="text-xs text-red-400 hover:text-red-700"
                              >
                                ✕
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleOpenRowMenu(e, li.id)
                                }}
                                title="More options"
                                className="text-xs text-zinc-400 hover:text-zinc-900"
                              >
                                ⋮
                              </button>
                              {openRowMenu === li.id && (
                                <div
                                  ref={rowMenuRef}
                                  style={menuStyle}
                                  className="z-50 w-56 rounded-md border bg-white dark:bg-zinc-900 shadow-md p-3 space-y-2 text-xs text-left"
                                >
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={li.isRecurring}
                                      onChange={(e) => onUpdate(li.id, { isRecurring: e.target.checked })}
                                    />
                                    Recurring
                                  </label>
                                  {li.isRecurring && (
                                    <select
                                      value={li.recurringInterval ?? "MONTHLY"}
                                      onChange={(e) =>
                                        onUpdate(li.id, {
                                          recurringInterval: e.target.value as RecurringInterval,
                                        })
                                      }
                                      className="w-full rounded border px-1 py-0.5 text-xs"
                                    >
                                      <option value="MONTHLY">Monthly</option>
                                      <option value="QUARTERLY">Quarterly</option>
                                      <option value="ANNUALLY">Annually</option>
                                    </select>
                                  )}
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={li.isOptional}
                                      onChange={(e) => onUpdate(li.id, { isOptional: e.target.checked })}
                                    />
                                    Optional
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={li.quantityAdjustable}
                                      onChange={(e) => onUpdate(li.id, { quantityAdjustable: e.target.checked })}
                                    />
                                    Qty adjustable in portal
                                  </label>
                                  <div>
                                    <label className="block text-zinc-500 mb-1">Choice group</label>
                                    <select
                                      value={li.choiceGroup ?? ""}
                                      onChange={async (e) => {
                                        if (e.target.value === "__new__") {
                                          const name = await promptDialog({ title: "New choice group name" })
                                          if (name) {
                                            onUpdate(li.id, { choiceGroup: name.trim() })
                                          }
                                        } else {
                                          onUpdate(li.id, { choiceGroup: e.target.value || null })
                                        }
                                      }}
                                      className="w-full rounded border px-1 py-0.5 text-xs"
                                    >
                                      <option value="">None</option>
                                      {existingChoiceGroups.map((g) => (
                                        <option key={g} value={g}>{g}</option>
                                      ))}
                                      <option value="__new__">+ New group...</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-zinc-500 mb-1">Bundle</label>
                                    <select
                                      value={li.bundleName ?? ""}
                                      onChange={(e) => onUpdate(li.id, { bundleName: e.target.value || null })}
                                      className="w-full rounded border px-1 py-0.5 text-xs"
                                    >
                                      <option value="">None</option>
                                      {existingBundleNames.map((b) => (
                                        <option key={b} value={b}>{b}</option>
                                      ))}
                                    </select>
                                    {existingBundleNames.length === 0 && (
                                      <p className="text-zinc-400 mt-1">
                                        No bundles yet — use + Bundle on the section header to create one.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </Cell>
                        </>
                      )}
                    </SortableRow>
                  )
                }

                function insertionAround(itemId: string) {
                  const showAbove = dragIndicator?.zone === "above" && dragIndicator.overId === itemId
                  const showBelow = dragIndicator?.zone === "below" && dragIndicator.overId === itemId
                  return { showAbove, showBelow }
                }

                const topCapId = sectionCapId(sectionKey, "top")
                const bottomCapId = sectionCapId(sectionKey, "bottom")

                return (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={verticalBandCollision}
                    onDragStart={(e) => handleDragStart(e, orderedItems)}
                    onDragOver={(e) => handleDragOver(e, orderedItems)}
                    onDragEnd={(e) => handleDragEnd(e, orderedItems)}
                    onDragCancel={() => {
                      setDragIndicator(null)
                      setActiveDragItem(null)
                    }}
                  >
                    <SortableContext items={topLevelItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <div className="w-full text-sm grid" style={{ gridTemplateColumns: GRID_COLS }}>
                        <Cell className={`${pad} pl-4 text-left text-xs text-zinc-500 border-b`} />
                        <Cell className={`${pad} text-left text-xs text-zinc-500 border-b`}>Config</Cell>
                        <Cell className={`${pad} text-left text-xs text-zinc-500 border-b`}>Part #</Cell>
                        <Cell className={`${pad} text-left text-xs text-zinc-500 border-b`}>Description</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Qty</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Unit Cost</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Modifier</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Unit Price</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Disc %</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Total</Cell>
                        <Cell className={`${pad} text-right text-xs text-zinc-500 border-b`}>Margin</Cell>
                        <Cell className={`${pad} pr-4 text-left text-xs text-zinc-500 border-b`} />

                        <SectionEdgeCap id={topCapId} />

                        {topLevelItems.map((li) => {
                          const { showAbove, showBelow } = insertionAround(li.id)
                          if (li.isBundleHeader) {
                            const children = sectionItems.filter(
                              (x) => x.bundleName === li.bundleName && !x.isBundleHeader
                            )
                            return (
                              <Fragment key={li.id}>
                                {showAbove && <InsertionLine />}
                                {renderRow(li, false)}
                                <SortableContext
                                  items={
                                    children.length > 0
                                      ? children.map((c) => c.id)
                                      : [emptyBundlePlaceholderId(li.bundleName ?? "")]
                                  }
                                  strategy={verticalListSortingStrategy}
                                >
                                  {children.length === 0 ? (
                                    <EmptyBundlePlaceholder bundleName={li.bundleName ?? ""} />
                                  ) : (
                                    children.map((child) => {
                                      const childInsertion = insertionAround(child.id)
                                      return (
                                        <Fragment key={child.id}>
                                          {childInsertion.showAbove && <InsertionLine />}
                                          {renderRow(child, true)}
                                          {childInsertion.showBelow && <InsertionLine />}
                                        </Fragment>
                                      )
                                    })
                                  )}
                                </SortableContext>
                                {showBelow && <InsertionLine />}
                              </Fragment>
                            )
                          }
                          return (
                            <Fragment key={li.id}>
                              {showAbove && <InsertionLine />}
                              {renderRow(li, false)}
                              {showBelow && <InsertionLine />}
                            </Fragment>
                          )
                        })}

                        <SectionEdgeCap id={bottomCapId} />
                      </div>
                    </SortableContext>

                    <DragOverlay>
                      {activeDragItem ? (
                        <div className="flex items-center gap-2 rounded-md border bg-white dark:bg-zinc-900 shadow-lg px-3 py-2 text-sm font-medium">
                          <GripVertical size={14} className="text-zinc-400" />
                          {activeDragItem.name || (activeDragItem.isBundleHeader ? "Bundle" : "Item")}
                        </div>
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                )
              })()}
            </div>
          )
        })}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="New section name (e.g. Hardware)"
            className="w-64 rounded-md border px-3 py-2 text-sm"
          />
          <Button
            variant="outline"
            onClick={() => {
              const name = newSectionName.trim()
              if (!name) return
              setPendingSections((prev) => (prev.includes(name) ? prev : [...prev, name]))
              setNewSectionName("")
            }}
          >
            + Add Section
          </Button>
        </div>
      </fieldset>

      {addModalSection !== null && (
        <AddLineItemModal
          catalog={catalog}
          onClose={() => {
            setAddModalSection(null)
            setAddToBundleName(null)
          }}
          onAddCatalog={(item, quantity) =>
            onCreate(addModalSection === NO_SECTION ? null : addModalSection, {
              catalogItemId: item.id,
              name: item.name,
              sku: item.sku ?? undefined,
              unitPrice: item.msrp,
              cost: item.cost,
              taxable: item.taxable,
              quantity,
              bundleName: addToBundleName ?? undefined,
            })
          }
          onAddAdhoc={(payload) =>
            onCreate(addModalSection === NO_SECTION ? null : addModalSection, {
              ...payload,
              bundleName: addToBundleName ?? payload.bundleName,
            })
          }
          onAddDistributor={(product, offer, quantity) =>
            onCreate(addModalSection === NO_SECTION ? null : addModalSection, {
              name: product.name,
              sku: offer.sku || product.partNumber,
              description: `Via ${offer.distributorLabel}${offer.isMock ? " (mock data — pending live distributor API)" : ""}`,
              unitPrice: offer.price,
              cost: offer.cost,
              quantity,
              taxable: true,
              bundleName: addToBundleName ?? undefined,
            })
          }
        />
      )}
    </div>
  )
}

// ─── Add Line Item Modal ────────────────────────────────────────────────
function AddLineItemModal({
  catalog,
  onClose,
  onAddCatalog,
  onAddAdhoc,
  onAddDistributor,
}: {
  catalog: CatalogOption[]
  onClose: () => void
  onAddCatalog: (item: CatalogOption, quantity: number) => void
  onAddAdhoc: (payload: Partial<LineItemBuilderItem>) => void
  onAddDistributor: (product: DistributorProductGroup, offer: DistributorOffer, quantity: number) => void
}) {
  const [mode, setMode] = useState<"catalog" | "distributor" | "adhoc">("catalog")
  const [search, setSearch] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [adhoc, setAdhoc] = useState({
    name: "",
    sku: "",
    quantity: "1",
    unitPrice: "0",
    cost: "0",
  })

  const [distQuery, setDistQuery] = useState("")
  const [distProducts, setDistProducts] = useState<DistributorProductGroup[]>([])
  const [distMessage, setDistMessage] = useState("")
  const [distLoading, setDistLoading] = useState(false)
  const [distQty, setDistQty] = useState(1)
  const [selectedOffers, setSelectedOffers] = useState<Record<string, DistributorKey>>({})

  async function runDistributorSearch() {
    if (!distQuery.trim()) return
    setDistLoading(true)
    const res = await fetch(`/api/distributor-search?q=${encodeURIComponent(distQuery)}`)
    const data = await res.json()
    const products: DistributorProductGroup[] = data.products ?? []
    setDistProducts(products)
    setDistMessage(data.message ?? "")
    const defaults: Record<string, DistributorKey> = {}
    products.forEach((p) => {
      const firstFound = p.offers.find((o) => o.found)
      if (firstFound) defaults[p.id] = firstFound.distributorKey
    })
    setSelectedOffers(defaults)
    setDistLoading(false)
  }

  function getSelectedOffer(product: DistributorProductGroup): DistributorOffer | undefined {
    const selectedKey = selectedOffers[product.id]
    return (
      product.offers.find((o) => o.distributorKey === selectedKey) ??
      product.offers.find((o) => o.found)
    )
  }

  const filtered = catalog.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.sku ?? "").toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Modal maxWidth="lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add Line Item</h2>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setMode("catalog")}
              className={mode === "catalog" ? "font-semibold underline" : "text-zinc-500"}
            >
              From Catalog
            </button>
            <button
              onClick={() => setMode("distributor")}
              className={mode === "distributor" ? "font-semibold underline" : "text-zinc-500"}
            >
              Search Distributors
            </button>
            <button
              onClick={() => setMode("adhoc")}
              className={mode === "adhoc" ? "font-semibold underline" : "text-zinc-500"}
            >
              Ad-Hoc Item
            </button>
          </div>
        </div>

        {mode === "catalog" && (
          <div className="space-y-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or part #..."
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-zinc-500">
                      {item.sku ?? "No SKU"} · ${item.msrp.toFixed(2)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      onAddCatalog(item, quantity)
                      onClose()
                    }}
                  >
                    Add
                  </Button>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-zinc-500">No catalog items match.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-500">Qty</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                className="w-20 rounded-md border px-2 py-1 text-sm"
              />
            </div>
          </div>
        )}

        {mode === "distributor" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={distQuery}
                onChange={(e) => setDistQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runDistributorSearch()}
                placeholder="Search across your connected distributors..."
                className="flex-1 rounded-md border px-3 py-2 text-sm"
              />
              <Button onClick={runDistributorSearch} disabled={distLoading}>
                {distLoading ? "Searching..." : "Search"}
              </Button>
            </div>

            {distMessage && (
              <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950 rounded p-2">
                {distMessage}
              </p>
            )}

            <div className="max-h-96 overflow-y-auto space-y-3">
              {distProducts.map((product) => {
                const selected = getSelectedOffer(product)
                return (
                  <div key={product.id} className="rounded-md border p-3">
                    <div className="flex gap-3">
                      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                        <ImageOff size={22} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-snug">{product.name}</p>
                        {product.manufacturer && (
                          <p className="text-xs text-zinc-500">{product.manufacturer} · {product.partNumber}</p>
                        )}
                        <div className="mt-1 flex items-center gap-3">
                          <span className="text-lg font-bold">
                            {selected ? money(selected.price) : "—"}
                          </span>
                          {selected && (
                            <span
                              className={
                                selected.availability > 0
                                  ? "text-xs text-green-600"
                                  : "text-xs text-amber-600"
                              }
                            >
                              {selected.availability > 0
                                ? `${selected.availability} in stock`
                                : "Check availability"}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={!selected}
                        onClick={() => {
                          if (!selected) return
                          onAddDistributor(product, selected, distQty)
                          onClose()
                        }}
                      >
                        Add to Quote
                      </Button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {product.offers.map((offer) => {
                        const isSelected = selected?.distributorKey === offer.distributorKey
                        if (!offer.found) {
                          return (
                            <div
                              key={offer.distributorKey}
                              className="flex w-24 flex-col items-center gap-0.5 rounded-md border border-dashed p-2 text-center opacity-60"
                            >
                              <span className="text-sm text-zinc-400">Not Found</span>
                              <span className="text-xs text-zinc-400">{offer.distributorLabel}</span>
                              <AlertTriangle size={13} className="text-amber-500 mt-0.5" />
                            </div>
                          )
                        }
                        return (
                          <button
                            key={offer.distributorKey}
                            type="button"
                            onClick={() =>
                              setSelectedOffers((prev) => ({ ...prev, [product.id]: offer.distributorKey }))
                            }
                            className={`relative flex w-24 flex-col items-center gap-0.5 rounded-md border p-2 text-center transition-colors ${
                              isSelected
                                ? "border-green-400 bg-green-50 dark:bg-green-950/30"
                                : "hover:border-zinc-400"
                            }`}
                          >
                            <span className="text-sm font-semibold">{money(offer.price)}</span>
                            <span className="text-xs text-zinc-500">{offer.distributorLabel}</span>
                            {isSelected ? (
                              <span className="absolute -bottom-1.5 -right-1.5 rounded-full bg-green-500 p-0.5 text-white">
                                <Check size={11} />
                              </span>
                            ) : (
                              <span className="mt-0.5 h-3 w-3 rounded-full border border-zinc-300" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {distProducts.length === 0 && !distLoading && distQuery && (
                <p className="text-sm text-zinc-500">No results yet — try searching above.</p>
              )}
            </div>

            {distProducts.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-500">Qty</label>
                <input
                  type="number"
                  value={distQty}
                  onChange={(e) => setDistQty(Number(e.target.value) || 1)}
                  className="w-20 rounded-md border px-2 py-1 text-sm"
                />
              </div>
            )}
          </div>
        )}

        {mode === "adhoc" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={adhoc.name}
                onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Part # (optional)</label>
                <input
                  type="text"
                  value={adhoc.sku}
                  onChange={(e) => setAdhoc({ ...adhoc, sku: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Qty</label>
                <input
                  type="number"
                  value={adhoc.quantity}
                  onChange={(e) => setAdhoc({ ...adhoc, quantity: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Unit Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={adhoc.unitPrice}
                  onChange={(e) => setAdhoc({ ...adhoc, unitPrice: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Cost (internal)</label>
                <input
                  type="number"
                  step="0.01"
                  value={adhoc.cost}
                  onChange={(e) => setAdhoc({ ...adhoc, cost: e.target.value })}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  if (!adhoc.name.trim()) return
                  onAddAdhoc({
                    name: adhoc.name,
                    sku: adhoc.sku || undefined,
                    quantity: Number(adhoc.quantity) || 1,
                    unitPrice: Number(adhoc.unitPrice) || 0,
                    cost: Number(adhoc.cost) || 0,
                  })
                  onClose()
                }}
              >
                Add Item
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
    </Modal>
  )
}