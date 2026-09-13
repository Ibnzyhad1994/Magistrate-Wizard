import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import {
  AUTH_SPLASH_FADE_MS,
  AUTH_SPLASH_HOLD_MS,
  shouldPlayAuthSplash,
} from "@/lib/auth-splash";

interface AuthSplashProps {
  continueLabel: string;
  onDismissed: () => void;
}

/**
 * Full-viewport brand splash on Sign In and Sign Up. Skippable; respects
 * reduced motion. Tokens only so light/accessible palettes keep the canvas.
 */
export function AuthSplash({ continueLabel, onDismissed }: AuthSplashProps) {
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => {
    onDismissedRef.current();
  }, []);

  const startLeave = useCallback(() => {
    setLeaving(true);
  }, []);

  useEffect(() => {
    if (!shouldPlayAuthSplash()) {
      finish();
      return;
    }
    const hold = window.setTimeout(startLeave, AUTH_SPLASH_HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [finish, startLeave]);

  useEffect(() => {
    if (!leaving) return;
    const fade = window.setTimeout(finish, AUTH_SPLASH_FADE_MS);
    return () => window.clearTimeout(fade);
  }, [leaving, finish]);

  return (
    <button
      type="button"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-visible bg-background px-6 text-foreground",
        "transition-opacity ease-out",
        leaving ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      style={{ transitionDuration: `${AUTH_SPLASH_FADE_MS}ms` }}
      aria-label={continueLabel}
      onClick={startLeave}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(var(--muted))_0%,_hsl(var(--background))_55%,_hsl(var(--background))_100%)]" />
      </span>
      <img
        src="/favicon.svg?v=2"
        alt=""
        width={80}
        height={80}
        decoding="async"
        className="auth-splash-mark relative z-10 h-[4.5rem] w-[4.5rem] rounded-[0.65rem] sm:h-20 sm:w-20"
      />
      <span className="auth-splash-word relative z-10 font-brand text-3xl font-semibold tracking-[0.08em] text-foreground sm:text-4xl">
        Magistrate
        <span className="text-primary"> Wizard</span>
      </span>
      <span className="sr-only">{APP_NAME}</span>
    </button>
  );
}
