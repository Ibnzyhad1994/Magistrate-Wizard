import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WalkthroughStep } from "@/lib/walkthrough";
import { tourCardPosition, tourCircleFromRect } from "@/lib/tour-geometry";
import { pickTourFocus, resolveTourTarget, scrollTourTargetIntoView } from "@/lib/tour-target";

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
  const [cardBox, setCardBox] = useState({ width: 320, height: 176 });
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    let focus: HTMLElement | null = null;

    const measure = () => {
      if (!focus || cancelled) return;
      setRect(focus.getBoundingClientRect());
    };

    void (async () => {
      const target = await resolveTourTarget(step);
      if (cancelled) return;
      if (!target) {
        setRect(null);
        return;
      }
      focus = pickTourFocus(target);
      scrollTourTargetIntoView(focus);
      measure();
    })();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const next = { width: node.offsetWidth, height: node.offsetHeight };
    setCardBox((prev) =>
      prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [step, stepIndex, stepCount, rect]);

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

  const circle = rect ? tourCircleFromRect(rect) : null;
  const cardPos = circle
    ? tourCardPosition(circle, { width: window.innerWidth, height: window.innerHeight }, cardBox)
    : { top: 96, left: Math.max(16, window.innerWidth / 2 - 160) };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
      <div className="absolute inset-0 bg-black/60" />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-md"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      )}
      {circle && (
        <div
          className="pointer-events-none absolute z-[81]"
          style={{ top: circle.top, left: circle.left, width: circle.size, height: circle.size }}
          aria-hidden="true"
        >
          <span className="tour-ring-pulse absolute inset-0 rounded-full border-2 border-[hsl(var(--primary))]" />
          <span className="absolute inset-[5px] rounded-full border-[3px] border-[hsl(var(--primary))] shadow-[0_0_18px_rgba(229,9,20,0.55)]" />
        </div>
      )}
      <div
        ref={cardRef}
        className="absolute z-[82] w-[min(20rem,calc(100vw-2rem))] rounded-md border border-white/15 bg-[#181818] p-4 text-white shadow-xl"
        style={{ top: cardPos.top, left: cardPos.left }}
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
