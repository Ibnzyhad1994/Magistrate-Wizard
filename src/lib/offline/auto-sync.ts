/**
 * Decides when queued work on this device is sent, so nobody has to press
 * "Sync pending" for it to reach the server.
 *
 * Triggers (wired in runtime.ts): app start, sign-in and unlock, the
 * browser `online` event, the tab becoming visible and the Capacitor
 * network change. Between them, a backoff timer keeps retrying while
 * anything is still queued, because a failed write leaves the browser
 * "online" and none of those events ever fires (a server blip, a flaky
 * link, a captive portal).
 *
 * One run at a time: a request made while a run is in flight is folded
 * into one more pass after it, and the caller's promise settles once that
 * pass is done, so "Sync now" always waits for a flush that started after
 * it was pressed.
 *
 * A pass started by the timer is a background pass; one started by a
 * person or an event is not. The flushes use that to leave a background
 * failure off a job's bounded attempt count.
 */

export type AutoSyncTimers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export type AutoSyncDeps = {
  /** Sends everything queued. Errors are reported by the flushes themselves. */
  flush: (pass: { background: boolean }) => Promise<void>;
  /** Anything still waiting that a later flush could send. */
  hasPending: () => boolean;
  /** Known offline: wait for the `online` or native network event instead. */
  isOffline: () => boolean;
  timers?: AutoSyncTimers;
  /** 0..1, for jitter. */
  random?: () => number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type AutoSync = {
  /** Flush now (or once more after the run in flight), then keep retrying while work remains. */
  flushNow: () => Promise<void>;
  /** Start the retry timer if work is waiting and none is set; for "something was just queued". */
  schedule: () => void;
  /** The delay the pending retry was set with, or null when none is set. For tests and diagnostics. */
  pendingRetryDelayMs: () => number | null;
};

export const AUTO_SYNC_BASE_DELAY_MS = 5_000;
export const AUTO_SYNC_MAX_DELAY_MS = 5 * 60_000;

/**
 * 5 s, 10 s, 20 s ... capped at 5 minutes, each scaled into 50-100% so a
 * court's devices coming back after the same outage do not retry in step.
 */
export const autoSyncDelay = (
  attempt: number,
  random: () => number = Math.random,
  baseMs = AUTO_SYNC_BASE_DELAY_MS,
  maxMs = AUTO_SYNC_MAX_DELAY_MS,
) => {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * (0.5 + random() / 2));
};

const defaultTimers: AutoSyncTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const createAutoSync = (deps: AutoSyncDeps): AutoSync => {
  const timers = deps.timers ?? defaultTimers;
  const random = deps.random ?? Math.random;
  const baseMs = deps.baseDelayMs ?? AUTO_SYNC_BASE_DELAY_MS;
  const maxMs = deps.maxDelayMs ?? AUTO_SYNC_MAX_DELAY_MS;

  let running: Promise<void> | null = null;
  /** The pass requested while one was running: null = none, false = explicit wins. */
  let nextPass: boolean | null = null;
  let attempt = 0;
  let timer: unknown = null;
  let timerDelay = 0;

  const clearTimer = () => {
    if (timer === null) return;
    timers.clear(timer);
    timer = null;
  };

  const schedule = () => {
    if (running || timer !== null) return;
    if (!deps.hasPending()) {
      attempt = 0;
      return;
    }
    if (deps.isOffline()) return;
    const delay = autoSyncDelay(attempt, random, baseMs, maxMs);
    timerDelay = delay;
    timer = timers.set(() => {
      timer = null;
      // Counted when a retry runs, not when one is set: a timer cleared by
      // an explicit flush must not lengthen the next wait.
      attempt += 1;
      void request(true);
    }, delay);
  };

  const runPasses = async (background: boolean) => {
    let pass: boolean | null = background;
    while (pass !== null) {
      nextPass = null;
      try {
        await deps.flush({ background: pass });
      } catch {
        // The flushes toast their own failures; the retry below still applies.
      }
      pass = nextPass;
    }
  };

  const request = (background: boolean): Promise<void> => {
    clearTimer();
    if (running) {
      nextPass = nextPass === null ? background : nextPass && background;
      return running;
    }
    running = runPasses(background).finally(() => {
      running = null;
      schedule();
    });
    return running;
  };

  return {
    flushNow: () => request(false),
    schedule,
    pendingRetryDelayMs: () => (timer === null ? null : timerDelay),
  };
};
