export type TourBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type TourCircle = {
  top: number;
  left: number;
  size: number;
};

export const TOUR_NAV_OFFSET = 76;
export const TOUR_FOOTER_OFFSET = 212;
export const TOUR_PAD = 16;
export const TOUR_CIRCLE_MAX = 120;

export function unionTourBoxes(boxes: TourBox[]): TourBox {
  if (boxes.length === 0) return { top: 0, left: 0, width: 0, height: 0 };
  const top = Math.min(...boxes.map((box) => box.top));
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { top, left, width: right - left, height: bottom - top };
}

export function visibleTourBox(
  rect: TourBox,
  viewport: { width: number; height: number },
): TourBox {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.left + rect.width, viewport.width);
  const bottom = Math.min(rect.top + rect.height, viewport.height);
  if (right <= left || bottom <= top) return rect;
  return { top, left, width: right - left, height: bottom - top };
}

export function padTourBox(
  box: TourBox,
  pad: number,
  viewport: { width: number; height: number },
): TourBox {
  const left = Math.max(0, box.left - pad);
  const top = Math.max(0, box.top - pad);
  const right = Math.min(viewport.width, box.left + box.width + pad);
  const bottom = Math.min(viewport.height, box.top + box.height + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function tourPageContentBox(
  headerBottom: number,
  viewport: { width: number; height: number },
): TourBox {
  const top = Math.min(Math.max(headerBottom, 0), viewport.height);
  return { top, left: 0, width: viewport.width, height: Math.max(0, viewport.height - top) };
}

export function tourCardPositionForPage(
  nav: TourBox | null,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
  headerBottom: number,
): { top: number; left: number } {
  const maxLeft = Math.max(TOUR_PAD, viewport.width - card.width - TOUR_PAD);
  const maxTop = Math.max(TOUR_PAD, viewport.height - card.height - TOUR_PAD);
  const top = Math.min(Math.max(headerBottom + 12, TOUR_PAD), maxTop);
  const navCenter = nav ? nav.left + nav.width / 2 : 0;
  const left = nav && navCenter > viewport.width * 0.6 ? TOUR_PAD : maxLeft;
  return { top, left };
}

export function tourCircleFromRect(rect: TourBox): TourCircle {
  const minSize = 48;
  const maxSize = TOUR_CIRCLE_MAX;
  const pad = 12;
  const natural = Math.max(rect.width, rect.height) + pad * 2;
  const size = Math.min(maxSize, Math.max(minSize, natural));
  return {
    left: rect.left + rect.width / 2 - size / 2,
    top: rect.top + rect.height / 2 - size / 2,
    size,
  };
}

export function tourCardPosition(
  circle: TourCircle,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): { top: number; left: number } {
  const gap = 12;
  const maxLeft = Math.max(TOUR_PAD, viewport.width - card.width - TOUR_PAD);
  const maxTop = Math.max(TOUR_PAD, viewport.height - card.height - TOUR_PAD);
  const clampLeft = (left: number) => Math.min(Math.max(TOUR_PAD, left), maxLeft);
  const clampTop = (top: number) => Math.min(Math.max(TOUR_PAD, top), maxTop);
  const centeredLeft = clampLeft(circle.left + circle.size / 2 - card.width / 2);
  const sideTop = clampTop(circle.top + circle.size / 2 - card.height / 2);

  const overlapsCircle = (pos: { top: number; left: number }) => {
    const pad = 4;
    return !(
      pos.left + card.width <= circle.left - pad ||
      pos.left >= circle.left + circle.size + pad ||
      pos.top + card.height <= circle.top - pad ||
      pos.top >= circle.top + circle.size + pad
    );
  };

  const fits = (pos: { top: number; left: number }) =>
    pos.top >= TOUR_PAD &&
    pos.left >= TOUR_PAD &&
    pos.top + card.height <= viewport.height - TOUR_PAD &&
    pos.left + card.width <= viewport.width - TOUR_PAD &&
    !overlapsCircle(pos);

  const below = { top: circle.top + circle.size + gap, left: centeredLeft };
  const above = { top: circle.top - gap - card.height, left: centeredLeft };
  const right = { top: sideTop, left: circle.left + circle.size + gap };
  const left = { top: sideTop, left: circle.left - gap - card.width };
  const rawCenteredLeft = circle.left + circle.size / 2 - card.width / 2;
  const order =
    rawCenteredLeft > maxLeft
      ? [left, below, above, right]
      : rawCenteredLeft < TOUR_PAD
        ? [right, below, above, left]
        : [below, above, right, left];

  for (const pos of order) {
    if (fits(pos)) return pos;
  }

  return { top: sideTop, left: clampLeft(circle.left - gap - card.width) };
}

export function tourFocusScrollDelta(
  rect: TourBox,
  viewportHeight: number,
  header = TOUR_NAV_OFFSET,
  footer = TOUR_FOOTER_OFFSET,
): number {
  const desiredTop = header + 12;
  const roomBelow = viewportHeight - footer;
  const circledBottom = rect.top + Math.max(rect.height, TOUR_CIRCLE_MAX);
  if (rect.height >= roomBelow - desiredTop) {
    return Math.round(rect.top - desiredTop);
  }
  if (rect.top >= desiredTop && circledBottom <= roomBelow) return 0;
  if (rect.top < desiredTop) return Math.round(rect.top - desiredTop);
  return Math.round(circledBottom - roomBelow);
}

export function tourTargetNeedsScroll(
  rect: TourBox,
  viewportHeight: number,
  header = TOUR_NAV_OFFSET,
  footer = TOUR_FOOTER_OFFSET,
): boolean {
  return tourFocusScrollDelta(rect, viewportHeight, header, footer) !== 0;
}
