import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { loadDeviceJson, saveDeviceJson } from "@/lib/device-storage";
import {
  clearWalkthroughAutoPlaySessions,
  hasWalkthroughAutoPlaySession,
  markWalkthroughAutoPlaySession,
  shouldAutoStartWalkthrough,
  walkthroughRecordAfterAutoStart,
  walkthroughRecordAfterComplete,
  walkthroughRecordForPending,
  walkthroughStepsFor,
  walkthroughStorageKey,
  type WalkthroughRecord,
} from "@/lib/walkthrough";
import { TourOverlay } from "@/components/tour/tour-overlay";
import { TourContext } from "@/components/tour/use-tour";
import { resolveTourTarget } from "@/lib/tour-target";
import type { UserRole } from "@/lib/constants";

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, profile, status } = useAuth();
  const { data: hasApprovedMagistrateCourt } = useHasApprovedMagistrateCourt();
  const location = useLocation();
  const navigate = useNavigate();
  const isPendingMagistrate = profile?.role === "magistrate" && hasApprovedMagistrateCourt === false;
  const steps = useMemo(
    () => walkthroughStepsFor(profile?.role as UserRole | undefined, isPendingMagistrate),
    [profile?.role, isPendingMagistrate],
  );
  const canWalkthrough = steps.length > 0;
  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const isActiveRef = useRef(false);
  const didAutoStartThisInstance = useRef(false);
  isActiveRef.current = isActive;

  const persistCompleted = useCallback(async () => {
    if (!user?.id) return;
    const key = walkthroughStorageKey(user.id);
    const existing = await loadDeviceJson<WalkthroughRecord>(key);
    await saveDeviceJson(key, walkthroughRecordAfterComplete(existing, new Date().toISOString()));
  }, [user?.id]);

  const handleStop = useCallback(
    async (completed: boolean) => {
      setIsActive(false);
      setStepIndex(0);
      if (completed) await persistCompleted();
    },
    [persistCompleted],
  );

  const startWalkthrough = useCallback(() => {
    if (steps.length === 0) return;
    setStepIndex(0);
    setIsActive(true);
    const firstRoute = steps[0]?.route;
    if (firstRoute && location.pathname !== firstRoute) {
      navigate(firstRoute);
    }
  }, [location.pathname, navigate, steps]);

  const startWalkthroughRef = useRef(startWalkthrough);
  startWalkthroughRef.current = startWalkthrough;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const handleSkip = useCallback(() => {
    void handleStop(true);
  }, [handleStop]);

  const handleNext = useCallback(() => {
    if (stepIndex >= steps.length - 1) {
      void handleStop(true);
      return;
    }
    const next = steps[stepIndex + 1];
    setStepIndex((i) => i + 1);
    if (next?.route && location.pathname !== next.route && !location.pathname.startsWith(`${next.route}/`)) {
      navigate(next.route);
    }
  }, [handleStop, location.pathname, navigate, stepIndex, steps]);

  const handleBack = useCallback(() => {
    if (stepIndex === 0) return;
    const prev = steps[stepIndex - 1];
    setStepIndex((i) => i - 1);
    if (prev?.route && location.pathname !== prev.route) {
      navigate(prev.route);
    }
  }, [location.pathname, navigate, stepIndex, steps]);

  useEffect(() => {
    if (!isActive) return;
    const step = steps[stepIndex];
    if (!step) return;
    void resolveTourTarget(step);
  }, [isActive, location.pathname, stepIndex, steps]);

  useEffect(() => {
    if (status !== "authenticated") {
      clearWalkthroughAutoPlaySessions();
      didAutoStartThisInstance.current = false;
    }
  }, [status]);

  useEffect(() => {
    didAutoStartThisInstance.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!user?.id || !profile) return;
    if (profile.role === "magistrate" && typeof hasApprovedMagistrateCourt !== "boolean") return;

    let cancelled = false;
    const key = walkthroughStorageKey(user.id);

    void (async () => {
      const record = await loadDeviceJson<WalkthroughRecord>(key);
      if (cancelled) return;

      if (isPendingMagistrate) {
        const next = walkthroughRecordForPending(record);
        if (next.awaitingAssignment !== record?.awaitingAssignment) {
          await saveDeviceJson(key, next);
        }
        return;
      }

      if (isActiveRef.current || didAutoStartThisInstance.current) return;
      if (stepsRef.current.length === 0) return;

      if (
        !shouldAutoStartWalkthrough({
          role: profile.role as UserRole,
          isPendingMagistrate,
          record,
          sessionAutoPlay: hasWalkthroughAutoPlaySession(user.id),
        })
      ) {
        return;
      }
      markWalkthroughAutoPlaySession(user.id);
      void saveDeviceJson(key, walkthroughRecordAfterAutoStart(record, new Date().toISOString()));
      if (cancelled) return;
      didAutoStartThisInstance.current = true;
      startWalkthroughRef.current();
    })();

    return () => {
      cancelled = true;
    };
  }, [hasApprovedMagistrateCourt, isPendingMagistrate, profile, status, user?.id]);

  const current = isActive ? steps[stepIndex] : undefined;

  return (
    <TourContext.Provider value={{ isActive, canWalkthrough, startWalkthrough }}>
      {children}
      {current && (
        <TourOverlay
          key={`${current.id}-${location.pathname}`}
          step={current}
          stepIndex={stepIndex}
          stepCount={steps.length}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleSkip}
        />
      )}
    </TourContext.Provider>
  );
}
