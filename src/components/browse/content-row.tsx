import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface ContentRowProps {
  title: string;
  href?: string;
  children: ReactNode;
  isLoading?: boolean;
  className?: string;
}

/**
 * Horizontally scrolling carousel row — the core Netflix browse metaphor.
 */
export function ContentRow({
  title,
  href,
  children,
  isLoading,
  className,
}: ContentRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.85, behavior: "smooth" });
  }

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
          onClick={() => scroll(-1)}
          className="absolute left-0 top-0 z-10 hidden h-full w-10 items-center justify-center bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/row:opacity-100 md:flex"
        >
          <ChevronLeft className="h-8 w-8" />
        </button>
        <div
          ref={scrollerRef}
          className="browse-gutter flex gap-2 overflow-x-auto scroll-smooth scrollbar-none"
        >
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="aspect-[2/3] w-[42vw] min-w-[9.5rem] max-w-[13.5rem] shrink-0 rounded-sm bg-white/10 sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]"
                />
              ))
            : children}
        </div>
        <button
          type="button"
          aria-label={`Scroll ${title} right`}
          onClick={() => scroll(1)}
          className="absolute right-0 top-0 z-10 hidden h-full w-10 items-center justify-center bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/row:opacity-100 md:flex"
        >
          <ChevronRight className="h-8 w-8" />
        </button>
      </div>
    </section>
  );
}
