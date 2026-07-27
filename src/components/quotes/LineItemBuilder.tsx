"use client"

import { useState, useRef, useEffect, Fragment } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@heroui/react"
import { Repeat, ToggleRight, SlidersHorizontal, GitBranch, Package, AlignLeft, GripVertical, ImageOff, Check, AlertTriangle } from "lucide-react"
import { useFixedMenuPosition, useCloseOnOutsideClick, useCloseOnScroll } from "@/lib/useFixedMenu"
import { Modal } from "@/components/Modal"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type Active,
  type Over,
} from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { DraggableAttributes } from "@dnd-kit/core"
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities"
import { DistributorProductGroup, DistributorOffer, DistributorKey } from "@/lib/distributors/types"

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
        <Tooltip key={key}>
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

// Wraps a single <tr> with dnd-kit sortable behavior. Row content is passed
// as a render-prop so each row type (bundle header / text block / regular
// item) can keep its own distinct cell layout while sharing the same drag
// mechanics.
function SortableRow({
  id,
  disabled,
  className,
  isDropTarget,
  // When set (including null), this transform is used INSTEAD of the row's
  // own computed one — lets a bundle's children visually shadow their
  // header's live drag-reorder animation, so the whole bundle appears to
  // move as one block during an outer drag, even though the children live
  // in a separate nested sortable context and have no drag of their own
  // happening. Left undefined during a normal/internal drag, so the row
  // falls back to its own transform as usual.
  transformOverride,
  // Reports this row's own live transform up to the parent — used by
  // bundle headers so their children can mirror it.
  onTransformChange,
  children,
}: {
  id: string
  disabled: boolean
  className?: string
  isDropTarget?: boolean
  transformOverride?: string | null
  onTransformChange?: (transform: string | null) => void
  children: (drag: { attributes: DraggableAttributes; listeners: SyntheticListenerMap | undefined; isDragging: boolean }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const ownTransformStr: string | null = transform ? CSS.Transform.toString(transform) ?? null : null

  useEffect(() => {
    onTransformChange?.(ownTransformStr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownTransformStr])

  const usingOverride = transformOverride !== undefined
  const style: React.CSSProperties = {
    transform: (usingOverride ? transformOverride : ownTransformStr) ?? undefined,
    transition: usingOverride ? "transform 200ms ease" : transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
  }
  const dropTargetClass = isDropTarget ? "ring-2 ring-inset ring-purple-500 bg-purple-100 dark:bg-purple-900/40" : ""
  return (
    <tr ref={setNodeRef} style={style} className={`${className ?? ""} ${dropTargetClass}`}>
      {children({ attributes, listeners, isDragging })}
    </tr>
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

// Given a moved item and whatever it's currently hovering over, decides
// whether the drop would join a bundle (append at the end of that bundle's
// members) or land at a specific position in the top-level list (headers +
// unbundled items + text blocks). Hovering any part of a bundle's visual
// block — its header OR one of its own child rows — counts as "over the
// bundle": at/below the header's own center joins it, above the header's
// center inserts before the whole block instead. Landing on a child row
// specifically is always treated as being below that bundle's header.
function resolveDropAction(
  overItem: LineItemBuilderItem,
  droppedAboveHeader: boolean
): { joinBundleName: string | null; insertBeforeId: string | null } {
  if (isBundleChild(overItem)) {
    return { joinBundleName: overItem.bundleName, insertBeforeId: null }
  }
  if (overItem.isBundleHeader) {
    return droppedAboveHeader
      ? { joinBundleName: null, insertBeforeId: overItem.id }
      : { joinBundleName: overItem.bundleName, insertBeforeId: null }
  }
  return { joinBundleName: null, insertBeforeId: overItem.id }
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
  const [dragOverBundleHeaderId, setDragOverBundleHeaderId] = useState<string | null>(null)
  // While an outer drag displaces a bundle header, this captures its live
  // transform so the header's children (in their own nested sortable
  // context) can be given the same transform to visually move as one block
  const [bundleTransforms, setBundleTransforms] = useState<Record<string, string | null>>({})

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
    const groupName = window.prompt('Name this choice group (e.g. "Support Tier"):')
    if (!groupName || !groupName.trim()) return
    const name = groupName.trim()
    await onCreate(section, { name: "Option 1", isOptional: true, choiceGroup: name })
    await onCreate(section, { name: "Option 2", isOptional: true, choiceGroup: name })
  }

  async function handleAddBundle(section: string | null) {
    const bundleName = window.prompt('Name this bundle (e.g. "Starter Kit"):')
    if (!bundleName || !bundleName.trim()) return
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
    if (!confirm("Remove this line item?")) return
    await onDelete(id)
  }

  // Distinguishes "dropping onto the header to join" from "dropping above
  // the header to reorder past it" — both register as the same closest
  // target, so position within the header's own bounds is what decides.
  function isDroppedAboveTarget(active: Active, over: Over): boolean {
    const activeRect = active.rect.current.translated ?? active.rect.current.initial
    if (!activeRect || !over.rect) return false
    const activeCenterY = activeRect.top + activeRect.height / 2
    const overCenterY = over.rect.top + over.rect.height / 2
    return activeCenterY < overCenterY
  }

  // Highlights a bundle header whenever the current drag would result in
  // joining it. Dragging a bundle's own child within that same bundle never
  // highlights anything — it's a plain internal reorder.
  function handleDragOver(event: DragOverEvent, sectionOrderedItems: LineItemBuilderItem[]) {
    const { active, over } = event
    if (!over) {
      setDragOverBundleHeaderId(null)
      return
    }
    const movedItem = sectionOrderedItems.find((i) => i.id === active.id)
    const overItem = sectionOrderedItems.find((i) => i.id === over.id)
    if (!movedItem || !overItem || movedItem.isBundleHeader || movedItem.isTextBlock) {
      setDragOverBundleHeaderId(null)
      return
    }

    if (isBundleChild(movedItem) && overItem.bundleName === movedItem.bundleName) {
      // Reordering within its own bundle — no join indicator needed
      setDragOverBundleHeaderId(null)
      return
    }

    const droppedAbove = isDroppedAboveTarget(active, over)
    const { joinBundleName } = resolveDropAction(overItem, droppedAbove)
    if (!joinBundleName) {
      setDragOverBundleHeaderId(null)
      return
    }
    const header = sectionOrderedItems.find((i) => i.isBundleHeader && i.bundleName === joinBundleName)
    setDragOverBundleHeaderId(header ? header.id : null)
  }

  async function handleDragEnd(event: DragEndEvent, sectionOrderedItems: LineItemBuilderItem[]) {
    setDragOverBundleHeaderId(null)
    setBundleTransforms({})
    const { active, over } = event
    if (!over || active.id === over.id) return

    const movedItem = sectionOrderedItems.find((i) => i.id === active.id)
    const overItem = sectionOrderedItems.find((i) => i.id === over.id)
    if (!movedItem || !overItem) return

    // ─── Case A: reordering within the SAME bundle — only its siblings move ──
    if (isBundleChild(movedItem)) {
      const overIsOwnHeader = overItem.isBundleHeader && overItem.bundleName === movedItem.bundleName
      const overIsSameBundleSibling = isBundleChild(overItem) && overItem.bundleName === movedItem.bundleName
      if (overIsOwnHeader || overIsSameBundleSibling) {
        const siblings = sectionOrderedItems.filter(
          (li) => li.bundleName === movedItem.bundleName && !li.isBundleHeader
        )
        const oldIndex = siblings.findIndex((i) => i.id === movedItem.id)
        const newIndex = overIsOwnHeader ? 0 : siblings.findIndex((i) => i.id === overItem.id)
        if (oldIndex === -1 || newIndex === -1) return
        const reordered = arrayMove(siblings, oldIndex, newIndex)
        await Promise.all(reordered.map((li, idx) => onUpdate(li.id, { sortOrder: idx })))
        return
      }
    }

    // ─── Case B: a bundle header or text block — always top-level reordering ──
    if (movedItem.isBundleHeader || movedItem.isTextBlock) {
      const topLevelItems = sectionOrderedItems.filter((li) => !isBundleChild(li))
      const overTopLevelItem = isBundleChild(overItem)
        ? sectionOrderedItems.find((i) => i.isBundleHeader && i.bundleName === overItem.bundleName)
        : overItem
      if (!overTopLevelItem) return
      const oldIndex = topLevelItems.findIndex((i) => i.id === movedItem.id)
      const newIndex = topLevelItems.findIndex((i) => i.id === overTopLevelItem.id)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(topLevelItems, oldIndex, newIndex)
      await Promise.all(reordered.map((li, idx) => onUpdate(li.id, { sortOrder: idx })))
      return
    }

    // ─── Case C: a regular item — either joining a bundle, or landing/staying
    // at a specific position in the top-level list (leaving its old bundle,
    // if it had one) ──
    const droppedAbove = isDroppedAboveTarget(active, over)
    const { joinBundleName, insertBeforeId } = resolveDropAction(overItem, droppedAbove)

    if (joinBundleName) {
      const siblings = sectionOrderedItems.filter(
        (li) => li.bundleName === joinBundleName && !li.isBundleHeader && li.id !== movedItem.id
      )
      const newSiblings = [...siblings, { ...movedItem, bundleName: joinBundleName }]
      await Promise.all(
        newSiblings.map((li, idx) =>
          onUpdate(li.id, { sortOrder: idx, ...(li.id === movedItem.id ? { bundleName: joinBundleName } : {}) })
        )
      )
      return
    }

    const topLevelItems = sectionOrderedItems.filter((li) => !isBundleChild(li) && li.id !== movedItem.id)
    let insertIdx = topLevelItems.length
    if (insertBeforeId) {
      const idx = topLevelItems.findIndex((i) => i.id === insertBeforeId)
      if (idx !== -1) insertIdx = idx
    }
    const reordered = [
      ...topLevelItems.slice(0, insertIdx),
      { ...movedItem, bundleName: null },
      ...topLevelItems.slice(insertIdx),
    ]
    await Promise.all(
      reordered.map((li, idx) => {
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
                        isDropTarget={dragOverBundleHeaderId === li.id}
                        onTransformChange={(t) => {
                          const key = li.bundleName ?? ""
                          setBundleTransforms((prev) => (prev[key] === t ? prev : { ...prev, [key]: t }))
                        }}
                        className={`border-b bg-purple-50 dark:bg-purple-950/30 ${getRowAccent(li)}`}
                      >
                        {(drag) => (
                          <>
                            <td className="py-2 pl-4">
                              <DragHandle attributes={drag.attributes} listeners={drag.listeners} disabled={locked} />
                            </td>
                            <td></td>
                            <td className="py-2 pr-4" colSpan={9}>
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
                                {dragOverBundleHeaderId === li.id && (
                                  <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">
                                    Drop to add to bundle
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pr-4">
                              <button
                                onClick={() => handleDelete(li.id)}
                                title="Delete bundle (items inside stay)"
                                className="text-xs text-red-400 hover:text-red-700"
                              >
                                ✕
                              </button>
                            </td>
                          </>
                        )}
                      </SortableRow>
                    )
                  }

                  if (li.isTextBlock) {
                    return (
                      <SortableRow
                        id={li.id}
                        disabled={locked}
                        className={`border-b last:border-0 align-top ${getRowAccent(li)}`}
                      >
                        {(drag) => (
                          <>
                            <td className="py-2 pl-4">
                              <DragHandle attributes={drag.attributes} listeners={drag.listeners} disabled={locked} />
                            </td>
                            <td></td>
                            <td className="py-2 pr-4" colSpan={9}>
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
                            </td>
                            <td className="py-2 pr-4">
                              <button
                                onClick={() => handleDelete(li.id)}
                                title="Delete"
                                className="text-xs text-red-400 hover:text-red-700"
                              >
                                ✕
                              </button>
                            </td>
                          </>
                        )}
                      </SortableRow>
                    )
                  }

                  return (
                    <SortableRow
                      id={li.id}
                      disabled={locked}
                      transformOverride={indent ? bundleTransforms[li.bundleName ?? ""] : undefined}
                      className="border-b last:border-0 align-top"
                    >
                      {(drag) => (
                        <>
                          <td className={`py-2 ${indent ? "pl-10" : "pl-4"} ${getRowAccent(li)}`}>
                            <DragHandle attributes={drag.attributes} listeners={drag.listeners} disabled={locked} />
                          </td>
                          <td className="py-2 pr-2">
                            <LineItemConfigIcons li={li} />
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              type="text"
                              defaultValue={li.sku ?? ""}
                              onBlur={(e) => onUpdate(li.id, { sku: e.target.value })}
                              className="w-24 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="py-2 pr-2">
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
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              defaultValue={li.quantity}
                              onBlur={(e) => onUpdate(li.id, { quantity: Number(e.target.value) })}
                              className="w-16 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              key={`cost-${li.id}-${li.cost}`}
                              type="number"
                              step="0.01"
                              defaultValue={li.cost}
                              onBlur={(e) => onUpdate(li.id, { cost: Number(e.target.value) })}
                              className="w-20 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="py-2 pr-2">
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
                              className="w-16 rounded border px-2 py-1 text-xs"
                            />
                            <span className="text-zinc-400"> %</span>
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              key={`price-${li.id}-${li.unitPrice}`}
                              type="number"
                              step="0.01"
                              defaultValue={li.unitPrice}
                              onBlur={(e) => onUpdate(li.id, { unitPrice: Number(e.target.value) })}
                              className="w-20 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              step="1"
                              defaultValue={li.discount}
                              onBlur={(e) => onUpdate(li.id, { discount: Number(e.target.value) })}
                              className="w-16 rounded border px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="py-2 pr-2 font-medium">{money(total)}</td>
                          <td className="py-2 pr-2 text-xs">
                            {money(margin)}
                            <br />
                            <span className={marginColor(marginPct)}>
                              {total > 0 ? `${marginPct.toFixed(0)}%` : "—"}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
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
                                      onChange={(e) => {
                                        if (e.target.value === "__new__") {
                                          const name = window.prompt("New choice group name:")
                                          if (name && name.trim()) {
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
                          </td>
                        </>
                      )}
                    </SortableRow>
                  )
                }

                return (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragOver={(e) => handleDragOver(e, orderedItems)}
                    onDragEnd={(e) => handleDragEnd(e, orderedItems)}
                    onDragCancel={() => {
                      setDragOverBundleHeaderId(null)
                      setBundleTransforms({})
                    }}
                  >
                    <SortableContext items={topLevelItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b text-left text-xs text-zinc-500">
                            <th className="py-2 pl-4 w-10"></th>
                            <th className="py-2 w-28">Config</th>
                            <th className="py-2">Part #</th>
                            <th className="py-2">Description</th>
                            <th className="py-2 w-20">Qty</th>
                            <th className="py-2 w-20">Unit Cost</th>
                            <th className="py-2 w-20">Modifier</th>
                            <th className="py-2 w-24">Unit Price</th>
                            <th className="py-2 w-20">Disc %</th>
                            <th className="py-2 w-24">Total</th>
                            <th className="py-2 w-20">Margin</th>
                            <th className="py-2 w-24 pr-4"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {topLevelItems.map((li) => {
                            if (li.isBundleHeader) {
                              const children = sectionItems.filter(
                                (x) => x.bundleName === li.bundleName && !x.isBundleHeader
                              )
                              return (
                                <Fragment key={li.id}>
                                  {renderRow(li, false)}
                                  <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                                    {children.map((child) => (
                                      <Fragment key={child.id}>{renderRow(child, true)}</Fragment>
                                    ))}
                                  </SortableContext>
                                </Fragment>
                              )
                            }
                            return <Fragment key={li.id}>{renderRow(li, false)}</Fragment>
                          })}
                        </tbody>
                      </table>
                    </SortableContext>
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
  // Which distributor is selected per product id — defaults to the first
  // found offer once results come in
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