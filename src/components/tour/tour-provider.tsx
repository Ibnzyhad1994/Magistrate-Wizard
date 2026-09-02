import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { loadDeviceJson, saveDeviceJson } from "@/lib/device-storage";
import { ROUTES } from "@/routes/paths";
import {
  WALKTHROUGH_VERSION,
  walkthroughStepsFor,
  walkthroughStorageKey,
  type WalkthroughRecord,
} from "@/lib/walkthrough";
import { resolveTourTarget, TourOverlay } from "@/components/tour/tour-overlay";
import type { UserRole } from "@/lib/constants";

type TourContextValue = {
  isActive: boolean;
  canWalkthrough: boolean;
  startWalkthrough: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export const useTour = (): TourContextValue => {
  const ctx = useContext(TourContext);
  if (!ctx) {
    return {
      isActive: false,
      canWalkthrough: false,
      startWalkthrough: () => undefined,
    };
  }
  return ctx;
};

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
  const autoStarted = useRef(false);

  const persistCompleted = useCallback(async () => {
    if (!user?.id) return;
    await saveDeviceJson(walkthroughStorageKey(user.id), {
      version: WALKTHROUGH_VERSION,
      completedAt: new Date().toISOString(),
    } satisfies WalkthroughRecord);
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
    if (autoStarted.current) return;
    if (status !== "authenticated") return;
    if (!user?.id || !profile) return;
    if (profile.role === "magistrate" && typeof hasApprovedMagistrateCourt !== "boolean") return;
    if (!canWalkthrough) {
      autoStarted.current = true;
      return;
    }
    if (location.pathname !== ROUTES.dashboard) return;
    autoStarted.current = true;
    void (async () => {
      const record = await loadDeviceJson<WalkthroughRecord>(walkthroughStorageKey(user.id));
      if (record?.version === WALKTHROUGH_VERSION && record.completedAt) return;
      startWalkthrough();
    })();
  }, [
    canWalkthrough,
    hasApprovedMagistrateCourt,
    location.pathname,
    profile,
    startWalkthrough,
    status,
    user?.id,
  ]);

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
