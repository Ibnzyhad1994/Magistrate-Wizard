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
export const TOUR_CIRCLE_MAX = 88;

export function tourCircleFromRect(rect: TourBox): TourCircle {
  const minSize = 48;
  const maxSize = TOUR_CIRCLE_MAX;
  const pad = 12;
  const natural = Math.max(rect.width, rect.height) + pad * 2;
  if (natural <= maxSize) {
    const size = Math.max(minSize, natural);
    return {
      left: rect.left + rect.width / 2 - size / 2,
      top: rect.top + rect.height / 2 - size / 2,
      size,
    };
  }
  const size = maxSize;
  return {
    left: rect.left - 8,
    top: rect.top - 8,
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
  const centeredLeft = circle.left + circle.size / 2 - card.width / 2;

  const belowTop = circle.top + circle.size + gap;
  if (belowTop + card.height <= viewport.height - TOUR_PAD) {
    return {
      top: belowTop,
      left: Math.min(Math.max(TOUR_PAD, centeredLeft), maxLeft),
    };
  }

  const aboveTop = circle.top - gap - card.height;
  if (aboveTop >= TOUR_PAD) {
    return {
      top: aboveTop,
      left: Math.min(Math.max(TOUR_PAD, centeredLeft), maxLeft),
    };
  }

  const sideTop = Math.min(
    Math.max(TOUR_PAD, circle.top + circle.size / 2 - card.height / 2),
    maxTop,
  );
  const rightLeft = circle.left + circle.size + gap;
  if (rightLeft + card.width <= viewport.width - TOUR_PAD) {
    return { top: sideTop, left: rightLeft };
  }
  const leftLeft = circle.left - gap - card.width;
  return {
    top: sideTop,
    left: Math.min(Math.max(TOUR_PAD, leftLeft), maxLeft),
  };
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
