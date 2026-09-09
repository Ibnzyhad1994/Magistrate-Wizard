/**
 * Audio confirmation for outcomes a magistrate might otherwise miss — a
 * save that completed, or an action that failed — while their attention
 * is on the bench rather than the screen.
 *
 * Two deliberate constraints, both from the setting this runs in:
 *
 *   SYNTHESISED, NOT SAMPLED. Tones are generated with Web Audio rather
 *   than shipped as audio files: nothing to download, nothing to cache,
 *   no request that a strict CSP could block, and no weight added to the
 *   bundle.
 *
 *   QUIET AND SHORT. Peak gain is deliberately low and every cue is under
 *   a fifth of a second. These are confirmations, not alerts — the screen
 *   remains the source of truth, and the toast still says what happened.
 *
 * On by default, opt-out from Settings, per device: a browser will not
 * play audio before the page has been interacted with anyway (see
 * getContext below), so there is no risk of noise on first load in a
 * silent room — by the time a cue could fire, someone has already
 * clicked something.
 */

const STORAGE_KEY = "magistrate-wizard-sound-cues";

export type SoundCue = "success" | "error";

/** Shapes are chosen to be distinguishable without being musical: rising = done, falling = problem. */
const CUES: Record<SoundCue, { freq: number[]; duration: number; gain: number }> = {
  // Two short rising notes — reads as "completed" without ceremony.
  success: { freq: [660, 880], duration: 0.075, gain: 0.05 },
  // Two falling notes, lower and a touch longer than success — noticeable,
  // never alarming. Kept at 0.095 so the pair still lands under the 0.2s
  // ceiling the header claims (and test-sound-cues.mjs enforces).
  error: { freq: [320, 245], duration: 0.095, gain: 0.06 },
};

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  // Created lazily on first play: browsers refuse an AudioContext until
  // the page has been interacted with, and by the time a save or an
  // error happens there always has been.
  if (!context) context = new Ctor();
  return context;
}

export function soundCuesEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // On by default: absent or anything but the literal "false" plays.
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    // Private-browsing or a blocked storage partition — default still
    // applies; a preference read must never break a save path.
    return true;
  }
}

export function setSoundCuesEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Preference simply won't persist; the current session still honours it.
  }
}

/**
 * Plays a cue if the user has switched them on. Safe to call from
 * anywhere — every failure path is swallowed, because a missing audio
 * device must never interfere with the action that triggered it.
 */
export function playCue(cue: SoundCue): void {
  if (!soundCuesEnabled()) return;
  try {
    const ctx = getContext();
    if (!ctx) return;
    // Autoplay policy can leave the context suspended after a reload.
    if (ctx.state === "suspended") void ctx.resume();

    const { freq, duration, gain } = CUES[cue];
    const start = ctx.currentTime;

    freq.forEach((hz, index) => {
      const at = start + index * duration;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, at);

      // Ramped rather than switched: an instant start or stop on a sine
      // produces an audible click at the discontinuity.
      amp.gain.setValueAtTime(0, at);
      amp.gain.linearRampToValueAtTime(gain, at + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);

      osc.connect(amp).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + duration + 0.02);
    });
  } catch {
    // Audio is a courtesy. It never reports its own failure.
  }
}

/** Lets Settings preview the cue it just switched on, without waiting for a real event. */
export function previewCue(cue: SoundCue): void {
  const wasEnabled = soundCuesEnabled();
  if (!wasEnabled) setSoundCuesEnabled(true);
  playCue(cue);
  if (!wasEnabled) setSoundCuesEnabled(false);
}
