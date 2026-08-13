import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Tracks whether a horizontal scroller can move left or right.
 * Used by tab strips and browse rows so mobile chrome (fades, chevrons)
 * only appears when there is overflow.
 */
export const useHScroll = (
  ref: RefObject<HTMLElement | null>,
  watch?: unknown,
) => {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const { scrollLeft, scrollWidth, clientWidth } = node;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, [ref]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  useEffect(() => {
    update();
  }, [update, watch]);

  return { canScrollLeft, canScrollRight, update };
};

export const hScrollMask = (canScrollLeft: boolean, canScrollRight: boolean) => {
  if (!canScrollLeft && !canScrollRight) return undefined;
  const left = canScrollLeft ? "transparent" : "#000";
  const right = canScrollRight ? "transparent" : "#000";
  return `linear-gradient(to right, ${left} 0, #000 1.25rem, #000 calc(100% - 1.25rem), ${right} 100%)`;
};
