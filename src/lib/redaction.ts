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

export function isUsableRedactionBox(box: RedactionBox): boolean {
  return box.width >= 0.004 && box.height >= 0.004
}
