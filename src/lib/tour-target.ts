import type { WalkthroughStep } from "@/lib/walkthrough";
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
  const primary = await waitForTarget(step.target);
  if (primary) return primary;
  if (step.fallbackTarget) return waitForTarget(step.fallbackTarget, 1500);
  return null;
};

export const pickTourFocus = (target: HTMLElement): HTMLElement => {
  const marked = target.querySelector<HTMLElement>("[data-tour-focus]");
  if (marked) {
    const rect = marked.getBoundingClientRect();
    if (rect.width > 2 && rect.height > 2) return marked;
  }
  const rect = target.getBoundingClientRect();
  const huge = rect.height > window.innerHeight * 0.4 || rect.width > window.innerWidth * 0.65;
  if (!huge) return target;
  const candidates = target.querySelectorAll<HTMLElement>("button, a[href], [role='button']");
  for (const node of candidates) {
    const next = node.getBoundingClientRect();
    if (next.width > 2 && next.height > 2) return node;
  }
  return target;
};

const isInsideFixed = (el: HTMLElement): boolean => {
  let node: HTMLElement | null = el;
  while (node && node !== document.documentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed") return true;
    node = node.parentElement;
  }
  return false;
};

export const scrollTourTargetIntoView = (el: HTMLElement): void => {
  if (isInsideFixed(el)) return;
  el.style.scrollMarginTop = `${TOUR_NAV_OFFSET}px`;
  el.style.scrollMarginBottom = `${TOUR_FOOTER_OFFSET}px`;
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  const rect = el.getBoundingClientRect();
  const delta = tourFocusScrollDelta(rect, window.innerHeight);
  if (delta === 0) return;
  window.scrollBy({ top: delta, behavior: "auto" });
};
