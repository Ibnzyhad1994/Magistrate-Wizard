import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WalkthroughStep } from "@/lib/walkthrough";
import {
  TOUR_NAV_OFFSET,
  padTourBox,
  tourCardPosition,
  tourCardPositionForPage,
  tourCircleFromRect,
  tourPageContentBox,
  unionTourBoxes,
  visibleTourBox,
  type TourBox,
} from "@/lib/tour-geometry";
import { pickTourFocus, resolveTourNav, resolveTourTarget, scrollTourTargetIntoView, tightTourBox } from "@/lib/tour-target";

const NAV_HOLE_PAD = 8;

export function TourOverlay({
  step,
  stepIndex,
  stepCount,
  onNext,
  onBack,
  onSkip,
  onContinue,
  onDone,
}: {
  step: WalkthroughStep;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onContinue?: () => void;
  onDone?: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [navBox, setNavBox] = useState<TourBox | null>(null);
  const [headerBottom, setHeaderBottom] = useState(TOUR_NAV_OFFSET);
  const [cardBox, setCardBox] = useState({ width: 320, height: 176 });
  const cardRef = useRef<HTMLDivElement>(null);
  const maskId = `tour-page-${useId().replace(/:/g, "")}`;

  useLayoutEffect(() => {
    let cancelled = false;
    let focus: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const timers: number[] = [];
    const isPage = step.kind === "page";

    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

    const measurePage = () => {
      if (cancelled || !isPage) return;
      const header = document.querySelector("header");
      setHeaderBottom(header?.getBoundingClientRect().bottom ?? TOUR_NAV_OFFSET);
      const nav = resolveTourNav(step);
      if (!nav) {
        setNavBox(null);
        return;
      }
      const box = nav.getBoundingClientRect();
      setNavBox(
        padTourBox(
          { top: box.top, left: box.left, width: box.width, height: box.height },
          NAV_HOLE_PAD,
          viewport(),
        ),
      );
    };

    const measure = () => {
      if (isPage) {
        measurePage();
        return;
      }
      if (!focus || cancelled) return;
      const primary = tightTourBox(focus);
      const joined = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-tour-join="${step.target}"]`),
      )
        .map((node) => node.getBoundingClientRect())
        .filter((box) => box.width > 2 && box.height > 2);
      const box = unionTourBoxes([
        primary,
        ...joined.map((item) => ({
          top: item.top,
          left: item.left,
          width: item.width,
          height: item.height,
        })),
      ]);
      setRect(new DOMRect(box.left, box.top, box.width, box.height));
    };

    const later = (fn: () => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(fn);
      });
    };

    const observe = () => {
      if (typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(() => measure());
      if (focus) observer.observe(focus);
      const header = document.querySelector("header");
      if (header) observer.observe(header);
      const nav = isPage ? resolveTourNav(step) : null;
      if (nav) observer.observe(nav);
    };

    void (async () => {
      if (step.kind === "choice") {
        setRect(null);
        setNavBox(null);
        return;
      }
      const target = await resolveTourTarget(step);
      if (cancelled) return;
      if (isPage) {
        measurePage();
        later(measurePage);
        observe();
        timers.push(window.setTimeout(measurePage, 120), window.setTimeout(measurePage, 400));
        return;
      }
      if (!target) {
        setRect(null);
        return;
      }
      focus = pickTourFocus(target);
      scrollTourTargetIntoView(focus);
      measure();
      later(measure);
      observe();
      timers.push(window.setTimeout(measure, 120), window.setTimeout(measure, 400));
    })();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      observer?.disconnect();
      for (const id of timers) window.clearTimeout(id);
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
  }, [step, stepIndex, stepCount, rect, navBox, headerBottom]);

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

  const isChoice = step.kind === "choice";
  const isPage = step.kind === "page";
  const viewport = { width: typeof window === "undefined" ? 1280 : window.innerWidth, height: typeof window === "undefined" ? 800 : window.innerHeight };
  const circle = !isChoice && !isPage && rect
    ? tourCircleFromRect(visibleTourBox(rect, viewport))
    : null;
  const contentBox = isPage ? tourPageContentBox(headerBottom, viewport) : null;
  const cardPos = isChoice
    ? {
        top: Math.max(16, viewport.height / 2 - cardBox.height / 2),
        left: Math.max(16, viewport.width / 2 - cardBox.width / 2),
      }
    : isPage
      ? tourCardPositionForPage(navBox, viewport, cardBox, headerBottom)
      : circle
        ? tourCardPosition(circle, viewport, cardBox)
        : { top: 96, left: Math.max(16, viewport.width / 2 - 160) };

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden pointer-events-auto" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
      <div className="absolute inset-0" />
      {circle ? (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            top: circle.top,
            left: circle.left,
            width: circle.size,
            height: circle.size,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
          }}
        />
      ) : isPage && contentBox ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={contentBox.left}
                y={contentBox.top}
                width={contentBox.width}
                height={contentBox.height}
                fill="black"
              />
              {navBox ? (
                <rect
                  x={navBox.left}
                  y={navBox.top}
                  width={navBox.width}
                  height={navBox.height}
                  rx="6"
                  fill="black"
                />
              ) : null}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.62)" mask={`url(#${maskId})`} />
        </svg>
      ) : (
        <div className="absolute inset-0 bg-black/60" />
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
            {(stepIndex > 0 || step.chapter === "rest") && (
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                Back
              </Button>
            )}
            {isChoice ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={onDone ?? onSkip}>
                  Done
                </Button>
                <Button type="button" size="sm" onClick={onContinue ?? onNext}>
                  Continue
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" onClick={onNext}>
                {stepIndex === stepCount - 1 ? "Done" : "Next"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
