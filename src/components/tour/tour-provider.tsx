import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { loadDeviceJson, saveDeviceJson } from "@/lib/device-storage";
import {
  clearWalkthroughAutoPlaySessions,
  docketMatterPathFromLocation,
  hasWalkthroughAutoPlaySession,
  markWalkthroughAutoPlaySession,
  shouldAutoStartWalkthrough,
  visibleWalkthroughSteps,
  walkthroughRecordAfterAutoStart,
  walkthroughRecordAfterComplete,
  walkthroughRecordForPending,
  walkthroughStepRoute,
  walkthroughStepsFor,
  walkthroughStorageKey,
  type WalkthroughChapter,
  type WalkthroughRecord,
} from "@/lib/walkthrough";
import { TourOverlay } from "@/components/tour/tour-overlay";
import { TourContext } from "@/components/tour/use-tour";
import { readFirstMatterHref, resolveTourTarget } from "@/lib/tour-target";
import { ROUTES } from "@/routes/paths";
import type { UserRole } from "@/lib/constants";

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, profile, status } = useAuth();
  const { data: hasApprovedMagistrateCourt } = useHasApprovedMagistrateCourt();
  const location = useLocation();
  const navigate = useNavigate();
  const isPendingMagistrate = profile?.role === "magistrate" && hasApprovedMagistrateCourt === false;
  const allSteps = useMemo(
    () => walkthroughStepsFor(profile?.role as UserRole | undefined, isPendingMagistrate),
    [profile?.role, isPendingMagistrate],
  );
  const canWalkthrough = allSteps.length > 0;
  const [isActive, setIsActive] = useState(false);
  const [chapter, setChapter] = useState<WalkthroughChapter>("sitting");
  const [hasMatter, setHasMatter] = useState(false);
  const [matterPath, setMatterPath] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepId, setStepId] = useState<string | null>(null);
  const isActiveRef = useRef(false);
  const hasMatterRef = useRef(false);
  const didAutoStartThisInstance = useRef(false);
  isActiveRef.current = isActive;
  hasMatterRef.current = hasMatter;

  const visible = useMemo(
    () => visibleWalkthroughSteps(allSteps, chapter, hasMatter),
    [allSteps, chapter, hasMatter],
  );

  useLayoutEffect(() => {
    if (!isActive || !stepId) return;
    const nextIndex = visible.findIndex((step) => step.id === stepId);
    if (nextIndex >= 0) {
      setStepIndex((current) => (current === nextIndex ? current : nextIndex));
    }
  }, [hasMatter, chapter, isActive, stepId, visible]);

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
      setStepId(null);
      setChapter("sitting");
      setHasMatter(false);
      setMatterPath(null);
      if (completed) await persistCompleted();
    },
    [persistCompleted],
  );

  const goToStep = useCallback(
    (index: number, nextChapter: WalkthroughChapter, nextHasMatter: boolean) => {
      const list = visibleWalkthroughSteps(allSteps, nextChapter, nextHasMatter);
      const step = list[index];
      if (!step) return;
      setChapter(nextChapter);
      setStepIndex(index);
      setStepId(step.id);
      const dest = walkthroughStepRoute(step, matterPath);
      if (dest && location.pathname !== dest) navigate(dest);
    },
    [allSteps, location.pathname, matterPath, navigate],
  );

  const startWalkthrough = useCallback(() => {
    if (allSteps.length === 0) return;
    setChapter("sitting");
    setHasMatter(false);
    setMatterPath(null);
    setIsActive(true);
    const first = visibleWalkthroughSteps(allSteps, "sitting", false)[0];
    setStepIndex(0);
    setStepId(first?.id ?? null);
    if (first?.route && location.pathname !== first.route) {
      navigate(first.route);
    }
  }, [allSteps, location.pathname, navigate]);

  const startWalkthroughRef = useRef(startWalkthrough);
  startWalkthroughRef.current = startWalkthrough;
  const stepsRef = useRef(allSteps);
  stepsRef.current = allSteps;

  const handleSkip = useCallback(() => {
    void handleStop(true);
  }, [handleStop]);

  const handleNext = useCallback(() => {
    const href = readFirstMatterHref();
    const fromPath = docketMatterPathFromLocation(location.pathname);
    const path = fromPath || href || matterPath;
    const nextHasMatter = Boolean(path) || hasMatter;
    if (path) {
      setMatterPath(path);
      setHasMatter(true);
    }
    const list = visibleWalkthroughSteps(allSteps, chapter, nextHasMatter);
    const currentId = visible[stepIndex]?.id;
    const indexInList = currentId ? list.findIndex((step) => step.id === currentId) : stepIndex;
    const index = indexInList >= 0 ? indexInList : stepIndex;
    if (index >= list.length - 1) {
      void handleStop(true);
      return;
    }
    const next = list[index + 1];
    setChapter(chapter);
    setStepIndex(index + 1);
    setStepId(next.id);
    const dest = walkthroughStepRoute(next, path);
    if (dest && location.pathname !== dest) navigate(dest);
  }, [allSteps, chapter, handleStop, hasMatter, location.pathname, matterPath, navigate, stepIndex, visible]);

  const handleContinue = useCallback(() => {
    goToStep(0, "rest", hasMatter);
  }, [goToStep, hasMatter]);

  const handleBack = useCallback(() => {
    if (chapter === "rest" && stepIndex === 0) {
      const sitting = visibleWalkthroughSteps(allSteps, "sitting", hasMatter);
      const choiceIndex = sitting.findIndex((step) => step.kind === "choice");
      goToStep(choiceIndex >= 0 ? choiceIndex : sitting.length - 1, "sitting", hasMatter);
      return;
    }
    if (stepIndex === 0) return;
    goToStep(stepIndex - 1, chapter, hasMatter);
  }, [allSteps, chapter, goToStep, hasMatter, stepIndex]);

  useEffect(() => {
    if (!isActive) return;
    const step = visible[stepIndex];
    if (!step) return;
    void resolveTourTarget(step);
  }, [isActive, location.pathname, stepIndex, visible]);

  useEffect(() => {
    if (!isActive) return;
    const fromPath = docketMatterPathFromLocation(location.pathname);
    if (fromPath) {
      setMatterPath(fromPath);
      setHasMatter(true);
      return;
    }
    if (location.pathname !== ROUTES.docket) return;

    let cancelled = false;
    void (async () => {
      const started = Date.now();
      while (Date.now() - started < 4000) {
        if (cancelled) return;
        const href = readFirstMatterHref();
        if (href) {
          setMatterPath(href);
          setHasMatter(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!cancelled && !hasMatterRef.current) setHasMatter(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isActive, location.pathname]);

  useEffect(() => {
    if (status === "locked" && isActiveRef.current) {
      void handleStop(false);
    }
  }, [handleStop, status]);

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

  const current = isActive ? visible[stepIndex] : undefined;

  return (
    <TourContext.Provider value={{ isActive, canWalkthrough, startWalkthrough }}>
      {children}
      {current && status !== "locked" && (
        <TourOverlay
          key={`${current.id}-${location.pathname}-${chapter}`}
          step={current}
          stepIndex={stepIndex}
          stepCount={visible.length}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={handleSkip}
          onContinue={handleContinue}
          onDone={() => void handleStop(true)}
        />
      )}
    </TourContext.Provider>
  );
}
