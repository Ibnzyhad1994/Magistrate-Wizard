import { useCallback, useEffect, useRef, useState } from "react";
import { SessionIdleWarning } from "@/components/auth/session-idle-warning";
import { SessionLockDialog } from "@/components/auth/session-lock-dialog";
import {
  ACTIVITY_THROTTLE_MS,
  evaluateSessionIdle,
  getIdleTimeoutMs,
  type IdlePhase,
} from "@/lib/auth/session-policy";
import { bumpRememberUntil } from "@/lib/auth/session-storage";
import { lockCurrentSession } from "@/lib/auth/session-lock";
import { recoverSessionWork } from "@/lib/auth/session-recovery";
import { useAuthStore } from "@/store/auth-store";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

/**
 * 1-hour idle clock for an open workspace. Remember-me restore starts a
 * fresh clock; a hidden tab that sits idle still locks on return.
 */
export function SessionLifecycle() {
  const status = useAuthStore((state) => state.status);
  const [phase, setPhase] = useState<IdlePhase>("ok");
  const lastActivityRef = useRef(Date.now());
  const lastBumpRef = useRef(0);
  const prevStatusRef = useRef(status);
  const idleMs = getIdleTimeoutMs();

  const bumpActivity = useCallback(() => {
    if (useAuthStore.getState().status !== "authenticated") return;
    const now = Date.now();
    lastActivityRef.current = now;
    if (now - lastBumpRef.current >= ACTIVITY_THROTTLE_MS) {
      lastBumpRef.current = now;
      bumpRememberUntil({ now });
    }
    setPhase("ok");
  }, []);

  const tick = useCallback(() => {
    if (useAuthStore.getState().status !== "authenticated") return;
    const next = evaluateSessionIdle({
      lastActivityAt: lastActivityRef.current,
      now: Date.now(),
      idleMs,
    });
    setPhase(next);
    if (next === "lock") void lockCurrentSession();
  }, [idleMs]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastBumpRef.current < ACTIVITY_THROTTLE_MS) {
        lastActivityRef.current = now;
        return;
      }
      bumpActivity();
    };
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });
    const interval = window.setInterval(tick, ACTIVITY_THROTTLE_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status, bumpActivity, tick]);

  useEffect(() => {
    if (status === "authenticated") {
      lastActivityRef.current = Date.now();
      setPhase("ok");
    }
  }, [status]);

  useEffect(() => {
    if (prevStatusRef.current === "locked" && status === "authenticated") {
      void recoverSessionWork();
    }
    prevStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as Window & { __mwLockSession?: () => Promise<void> };
    w.__mwLockSession = lockCurrentSession;
    return () => {
      delete w.__mwLockSession;
    };
  }, []);

  return (
    <>
      {status === "authenticated" && phase === "warn" ? (
        <SessionIdleWarning onContinue={bumpActivity} />
      ) : null}
      {status === "locked" ? <SessionLockDialog /> : null}
    </>
  );
}
