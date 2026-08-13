import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

const SIZE = {
  sm: { mark: "h-7 w-7", type: "text-[0.95rem] leading-none" },
  md: { mark: "h-8 w-8", type: "text-[1.05rem] leading-none sm:text-[1.15rem]" },
  lg: { mark: "h-10 w-10", type: "text-2xl leading-none sm:text-[1.75rem]" },
} as const;

interface AppLogoProps {
  size?: keyof typeof SIZE;
  markOnly?: boolean;
  className?: string;
}

/**
 * Brand lockup: crimson MW seal + Cinzel wordmark.
 * The seal is the same artwork as `/favicon.svg`.
 */
export function AppLogo({ size = "md", markOnly = false, className }: AppLogoProps) {
  const scale = SIZE[size];

  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      aria-label={APP_NAME}
    >
      <img
        src="/favicon.svg?v=2"
        alt=""
        className={cn("shrink-0 rounded-[0.4rem] shadow-[0_1px_8px_rgba(229,9,20,0.35)]", scale.mark)}
        width={32}
        height={32}
        decoding="async"
      />
      {markOnly ? (
        <span className="sr-only">{APP_NAME}</span>
      ) : (
        <span
          className={cn(
            "font-brand font-semibold tracking-[0.06em] whitespace-nowrap",
            scale.type,
          )}
        >
          <span className="text-white">Magistrate</span>
          <span className="text-primary"> Wizard</span>
        </span>
      )}
    </span>
  );
}
