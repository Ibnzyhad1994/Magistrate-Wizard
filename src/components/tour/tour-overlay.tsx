import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WalkthroughStep } from "@/lib/walkthrough";

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
  while (Date.now() - started < timeoutMs) {
    const el = findTourTarget(id);
    if (el) return el;
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

export function TourOverlay({
  step,
  stepIndex,
  stepCount,
  onNext,
  onBack,
  onSkip,
}: {
  step: WalkthroughStep;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const update = () => {
      const el = findTourTarget(step.target) ?? (step.fallbackTarget ? findTourTarget(step.fallbackTarget) : null);
      if (!cancelled) setRect(el?.getBoundingClientRect() ?? null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSkip]);

  const cardWidth = 320;
  const pad = 16;
  const cardLeft = rect
    ? Math.min(Math.max(pad, rect.left), window.innerWidth - cardWidth - pad)
    : Math.max(pad, window.innerWidth / 2 - cardWidth / 2);
  const cardTop = rect
    ? rect.bottom + 12 + 160 > window.innerHeight
      ? Math.max(pad, rect.top - 168)
      : rect.bottom + 12
    : 96;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
      <div className="absolute inset-0 bg-black/60" />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-[hsl(var(--match))] ring-offset-2 ring-offset-transparent"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      )}
      <div
        className="absolute w-[min(20rem,calc(100vw-2rem))] rounded-md border border-white/15 bg-[#181818] p-4 text-white shadow-xl"
        style={{ top: cardTop, left: cardLeft }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          {stepIndex + 1} of {stepCount}
        </p>
        <h2 id="walkthrough-title" className="mt-1 text-base font-semibold">
          {step.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/80">{step.body}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip} className="text-white/70 hover:text-white">
            Skip
          </Button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                Back
              </Button>
            )}
            <Button type="button" size="sm" onClick={onNext}>
              {stepIndex === stepCount - 1 ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
