import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useHScroll } from "@/hooks/use-h-scroll";

interface ContentRowProps {
  title: string;
  href?: string;
  children: ReactNode;
  isLoading?: boolean;
  className?: string;
}

/**
 * Horizontally scrolling carousel row — the core Netflix browse metaphor.
 * On mobile the edge chevrons stay available whenever the row overflows,
 * so a magistrate can page tiles without relying only on a swipe.
 */
export function ContentRow({
  title,
  href,
  children,
  isLoading,
  className,
}: ContentRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { canScrollLeft, canScrollRight } = useHScroll(scrollerRef, [
    isLoading,
    children,
  ]);

  const handleScroll = (direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className={cn("group/row relative space-y-3", className)}>
      <div className="browse-gutter flex items-baseline justify-between">
        {href ? (
          <Link
            to={href}
            className="text-lg font-semibold tracking-tight text-foreground hover:text-white/80"
          >
            {title}
          </Link>
        ) : (
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        )}
        {href && (
          <Link
            to={href}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-white"
          >
            See all
          </Link>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label={`Scroll ${title} left`}
          onClick={() => handleScroll(-1)}
          disabled={!canScrollLeft}
          className={cn(
            "absolute left-0 top-0 z-10 flex h-full w-9 items-center justify-center bg-gradient-to-r from-black/85 to-transparent text-white transition-opacity",
            canScrollLeft
              ? "opacity-100 md:opacity-0 md:group-hover/row:opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
        <div
          ref={scrollerRef}
          className="browse-gutter flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth scrollbar-none scroll-px-[4vw]"
        >
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="aspect-[2/3] w-[42vw] min-w-[9.5rem] max-w-[13.5rem] shrink-0 snap-start rounded-sm bg-white/10 sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]"
                />
              ))
            : children}
        </div>
        <button
          type="button"
          aria-label={`Scroll ${title} right`}
          onClick={() => handleScroll(1)}
          disabled={!canScrollRight}
          className={cn(
            "absolute right-0 top-0 z-10 flex h-full w-9 items-center justify-center bg-gradient-to-l from-black/85 to-transparent text-white transition-opacity",
            canScrollRight
              ? "opacity-100 md:opacity-0 md:group-hover/row:opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      </div>
    </section>
  );
}
