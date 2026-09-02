import { FIRST_MATTER_TOUR_ID, type WalkthroughStep } from "@/lib/walkthrough";
import { TOUR_FOOTER_OFFSET, TOUR_NAV_OFFSET, tourFocusScrollDelta } from "@/lib/tour-geometry";

export const findTourTarget = (id: string): HTMLElement | null => {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`);
  return (
    Array.from(nodes).find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    }) ?? null
  );
};

const isOnscreen = (el: HTMLElement): boolean => {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 2 &&
    rect.height > 2 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
};

export const findVisibleTourTarget = (id: string): HTMLElement | null => {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`);
  return Array.from(nodes).find(isOnscreen) ?? null;
};

export const resolveTourNav = (step: WalkthroughStep): HTMLElement | null => {
  if (step.kind !== "page") return null;
  const ids = [step.navTarget, step.fallbackTarget, "nav-more"];
  for (const id of ids) {
    if (!id) continue;
    const el = findVisibleTourTarget(id);
    if (el) return el;
  }
  return null;
};

const waitForTarget = async (id: string, timeoutMs = 4000): Promise<HTMLElement | null> => {
  const started = Date.now();
  let sawNode = false;
  while (Date.now() - started < timeoutMs) {
    const el = findTourTarget(id);
    if (el) return el;
    if (document.querySelector(`[data-tour="${id}"]`)) {
      sawNode = true;
    } else if (!sawNode && Date.now() - started > 400) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return findTourTarget(id);
};

export const resolveTourTarget = async (step: WalkthroughStep): Promise<HTMLElement | null> => {
  if (!step.target || step.kind === "choice") return null;
  const primary = await waitForTarget(step.target);
  if (primary) return primary;
  if (step.fallbackTarget) return waitForTarget(step.fallbackTarget, 1500);
  return null;
};

export const readFirstMatterHref = (): string | null => {
  const nodes = document.querySelectorAll<HTMLAnchorElement>(`a[data-tour="${FIRST_MATTER_TOUR_ID}"]`);
  const match = Array.from(nodes).find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2 && Boolean(el.getAttribute("href"));
  });
  const href = match?.getAttribute("href");
  return href ? href.split("?")[0] : null;
};

const isUsableBox = (rect: DOMRect): boolean => rect.width > 2 && rect.height > 2;

export const pickTourFocus = (target: HTMLElement): HTMLElement => {
  const marked = target.querySelector<HTMLElement>("[data-tour-focus]");
  if (marked && isUsableBox(marked.getBoundingClientRect())) return marked;
  const rect = target.getBoundingClientRect();
  const huge = rect.height > window.innerHeight * 0.4 || rect.width > window.innerWidth * 0.65;
  if (!huge) return target;
  const candidates = target.querySelectorAll<HTMLElement>("button, a[href], [role='button']");
  for (const node of candidates) {
    const next = node.getBoundingClientRect();
    if (isUsableBox(next)) return node;
  }
  return target;
};

/** Use the painted text box so a full-width heading still rings the words. */
export const tightTourBox = (el: HTMLElement): { top: number; left: number; width: number; height: number } => {
  const fallback = el.getBoundingClientRect();
  const tag = el.tagName;
  if (tag !== "H1" && tag !== "H2" && tag !== "H3") {
    return { top: fallback.top, left: fallback.left, width: fallback.width, height: fallback.height };
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter(isUsableBox);
  if (rects.length === 0) {
    return { top: fallback.top, left: fallback.left, width: fallback.width, height: fallback.height };
  }
  const top = Math.min(...rects.map((box) => box.top));
  const left = Math.min(...rects.map((box) => box.left));
  const right = Math.max(...rects.map((box) => box.right));
  const bottom = Math.max(...rects.map((box) => box.bottom));
  return { top, left, width: right - left, height: bottom - top };
};

const isInsideFixedOrSticky = (el: HTMLElement): boolean => {
  let node: HTMLElement | null = el;
  while (node && node !== document.documentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
    node = node.parentElement;
  }
  return false;
};

export const scrollTourTargetIntoView = (el: HTMLElement): void => {
  if (isInsideFixedOrSticky(el)) return;
  el.style.scrollMarginTop = `${TOUR_NAV_OFFSET}px`;
  el.style.scrollMarginBottom = `${TOUR_FOOTER_OFFSET}px`;
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  const rect = el.getBoundingClientRect();
  const delta = tourFocusScrollDelta(rect, window.innerHeight);
  if (delta === 0) return;
  window.scrollBy({ top: delta, behavior: "auto" });
};
