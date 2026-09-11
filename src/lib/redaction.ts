export type RedactionBox = {
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Normalize a drag that may go up/left so x/y are the origin and width/height are positive. */
export function normalizePixelRect(rect: {
  x: number
  y: number
  width: number
  height: number
}) {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x
  const y = rect.height < 0 ? rect.y + rect.height : rect.y
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

export function pixelRectToNormalized(
  rect: { x: number; y: number; width: number; height: number },
  page: { width: number; height: number },
  pageNumber: number,
): RedactionBox {
  const n = normalizePixelRect(rect)
  const w = page.width || 1
  const h = page.height || 1
  return clampRedactionBox({
    pageNumber,
    x: n.x / w,
    y: n.y / h,
    width: n.width / w,
    height: n.height / h,
  })
}

export function normalizedToPixelRect(
  box: RedactionBox,
  page: { width: number; height: number },
) {
  return {
    x: box.x * page.width,
    y: box.y * page.height,
    width: box.width * page.width,
    height: box.height * page.height,
  }
}

export function clampRedactionBox(box: RedactionBox): RedactionBox {
  const x = clamp01(box.x)
  const y = clamp01(box.y)
  const width = clamp01(box.width)
  const height = clamp01(box.height)
  return {
    pageNumber: box.pageNumber,
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  }
}

export function undoRedaction(boxes: RedactionBox[]): RedactionBox[] {
  return boxes.slice(0, -1)
}

export function boxesForPage(boxes: RedactionBox[], pageNumber: number): RedactionBox[] {
  return boxes.filter((box) => box.pageNumber === pageNumber)
}

/**
 * One page's boxes, each carrying its index in the FULL list.
 *
 * The viewer holds every page's boxes in one array but renders a page at
 * a time, so a box's position within its page is not its position in that
 * array. Removing "the second box on page 4" needs the index the list
 * actually uses, and recovering it by value would be ambiguous the moment
 * two identical rectangles exist. Pairing the index at filter time keeps
 * removal unambiguous without giving RedactionBox an identity field that
 * the burn step has no use for.
 */
export function pageBoxEntries(
  boxes: RedactionBox[],
  pageNumber: number,
): { box: RedactionBox; index: number }[] {
  return boxes
    .map((box, index) => ({ box, index }))
    .filter((entry) => entry.box.pageNumber === pageNumber)
}

/**
 * Drop one box by index. Undo only ever removes the most recent box, which
 * makes correcting an earlier mistake cost every good box drawn after it —
 * on a document where a misplaced box means leaked text, that pushes people
 * toward redrawing rather than fixing.
 *
 * Out-of-range indices return the list unchanged rather than throwing: the
 * caller is a click handler on a list that can re-render underneath it.
 */
export function removeRedactionBoxAt(boxes: RedactionBox[], index: number): RedactionBox[] {
  if (!Number.isInteger(index) || index < 0 || index >= boxes.length) return boxes
  return [...boxes.slice(0, index), ...boxes.slice(index + 1)]
}

export function isUsableRedactionBox(box: RedactionBox): boolean {
  return box.width >= 0.004 && box.height >= 0.004
}
