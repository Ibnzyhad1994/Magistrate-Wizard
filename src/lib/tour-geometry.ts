export type TourBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/**
 * The highlighted region. `radius` is a plain CSS border-radius, so a
 * circle is simply a square box whose radius is half its size — the
 * overlay renders one shape and doesn't branch.
 */
export type TourSpotlight = TourBox & { radius: number };

export const TOUR_NAV_OFFSET = 76;
export const TOUR_FOOTER_OFFSET = 212;
export const TOUR_PAD = 16;
/** Below this, a target is small enough that a circle reads as pointing AT it. */
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

/** Past this width:height ratio a circle can no longer cover the target honestly. */
const TOUR_CIRCLE_MAX_ASPECT = 1.8;
const TOUR_SPOTLIGHT_PAD = 10;
const TOUR_SPOTLIGHT_MIN = 48;
const TOUR_RECT_RADIUS = 14;

/**
 * The spotlight shape follows its target.
 *
 * The previous version always produced a circle capped at 120px and
 * centred on the target. For anything bigger or wider than that cap — the
 * procedure board, the matter tab strip, a table column, the home
 * billboard — the result was a small circle floating in the middle of a
 * much larger element, drawing the eye to a point that meant nothing and
 * leaving the thing being described outside the highlight entirely. On a
 * short wide target like a column header the opposite happened: a 120px
 * circle over a 40px-tall header bled well above and below it.
 *
 * So: a small, roughly-square target still gets a circle, which is the
 * right shape for a button or a single cell. Anything else gets a rounded
 * rectangle hugging its real bounds, which is the right shape for a
 * board, a strip, or a column.
 */
export function tourSpotlightFromRect(rect: TourBox): TourSpotlight {
  const padded = {
    top: rect.top - TOUR_SPOTLIGHT_PAD,
    left: rect.left - TOUR_SPOTLIGHT_PAD,
    width: rect.width + TOUR_SPOTLIGHT_PAD * 2,
    height: rect.height + TOUR_SPOTLIGHT_PAD * 2,
  };

  const longest = Math.max(padded.width, padded.height);
  const shortest = Math.max(1, Math.min(padded.width, padded.height));
  const aspect = longest / shortest;

  const fitsCircle = longest <= TOUR_CIRCLE_MAX && aspect <= TOUR_CIRCLE_MAX_ASPECT;

  if (fitsCircle) {
    const size = Math.max(TOUR_SPOTLIGHT_MIN, longest);
    return {
      left: rect.left + rect.width / 2 - size / 2,
      top: rect.top + rect.height / 2 - size / 2,
      width: size,
      height: size,
      radius: size / 2,
    };
  }

  // Never let the rounded corners swallow a thin target — a 40px-tall
  // strip with a 14px radius on both ends would render as a lozenge.
  const radius = Math.min(TOUR_RECT_RADIUS, Math.min(padded.width, padded.height) / 2);
  return { ...padded, radius };
}

/**
 * Places the explanation card clear of the spotlight. Takes a box rather
 * than a circle so it works for both shapes — a large rectangular
 * spotlight (the board, a tab strip) needs the card pushed further than a
 * small circle would, and treating one as the other put the card on top
 * of the very thing being pointed at.
 */
export function tourCardPosition(
  spot: TourBox,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): { top: number; left: number } {
  const gap = 12;
  const maxLeft = Math.max(TOUR_PAD, viewport.width - card.width - TOUR_PAD);
  const maxTop = Math.max(TOUR_PAD, viewport.height - card.height - TOUR_PAD);
  const clampLeft = (left: number) => Math.min(Math.max(TOUR_PAD, left), maxLeft);
  const clampTop = (top: number) => Math.min(Math.max(TOUR_PAD, top), maxTop);
  const centeredLeft = clampLeft(spot.left + spot.width / 2 - card.width / 2);
  const sideTop = clampTop(spot.top + spot.height / 2 - card.height / 2);

  const overlapsSpot = (pos: { top: number; left: number }) => {
    const pad = 4;
    return !(
      pos.left + card.width <= spot.left - pad ||
      pos.left >= spot.left + spot.width + pad ||
      pos.top + card.height <= spot.top - pad ||
      pos.top >= spot.top + spot.height + pad
    );
  };

  const fits = (pos: { top: number; left: number }) =>
    pos.top >= TOUR_PAD &&
    pos.left >= TOUR_PAD &&
    pos.top + card.height <= viewport.height - TOUR_PAD &&
    pos.left + card.width <= viewport.width - TOUR_PAD &&
    !overlapsSpot(pos);

  const below = { top: spot.top + spot.height + gap, left: centeredLeft };
  const above = { top: spot.top - gap - card.height, left: centeredLeft };
  const right = { top: sideTop, left: spot.left + spot.width + gap };
  const left = { top: sideTop, left: spot.left - gap - card.width };
  const rawCenteredLeft = spot.left + spot.width / 2 - card.width / 2;
  const order =
    rawCenteredLeft > maxLeft
      ? [left, below, above, right]
      : rawCenteredLeft < TOUR_PAD
        ? [right, below, above, left]
        : [below, above, right, left];

  for (const pos of order) {
    if (fits(pos)) return pos;
  }

  // A spotlight large enough to leave no clear side (the whole board on a
  // short viewport) still needs the card somewhere readable: pin it to
  // the corner furthest from the spotlight's centre rather than letting
  // it land dead centre on top of the target.
  const spotCentreY = spot.top + spot.height / 2;
  return {
    top: spotCentreY > viewport.height / 2 ? TOUR_PAD : maxTop,
    left: clampLeft(centeredLeft),
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
  // Scroll against the spotlight, not the raw element: the highlight is
  // what has to end up on screen, and it is padded (and, for a small
  // target, grown to a minimum circle) beyond the element's own bounds.
  const spot = tourSpotlightFromRect(rect);
  const spotBottom = spot.top + spot.height;
  if (spot.height >= roomBelow - desiredTop) {
    return Math.round(spot.top - desiredTop);
  }
  if (spot.top >= desiredTop && spotBottom <= roomBelow) return 0;
  if (spot.top < desiredTop) return Math.round(spot.top - desiredTop);
  return Math.round(spotBottom - roomBelow);
}

export function tourTargetNeedsScroll(
  rect: TourBox,
  viewportHeight: number,
  header = TOUR_NAV_OFFSET,
  footer = TOUR_FOOTER_OFFSET,
): boolean {
  return tourFocusScrollDelta(rect, viewportHeight, header, footer) !== 0;
}
