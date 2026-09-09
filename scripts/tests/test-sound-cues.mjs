/**
 * The sound-cue constraints exist because this runs in an active
 * courtroom. They're asserted here so they survive future edits — a
 * later "just make it a bit more audible" change should fail a test, not
 * ship silently into a sitting.
 */
import { readFileSync } from "node:fs";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const src = readFileSync("src/lib/sound-cues.ts", "utf8");

// --- default state ---------------------------------------------------------
// The single most important property: opening the app in a courtroom
// must not make a sound.

check(
  "cues are off unless localStorage explicitly says 'true'",
  /getItem\(STORAGE_KEY\)\s*===\s*"true"/.test(src),
  true,
);
check(
  "a storage failure falls back to OFF, never on",
  /catch\s*\{[^}]*return false/s.test(src),
  true,
);
check(
  "playCue returns early when cues are disabled",
  /export function playCue[^]*?if \(!soundCuesEnabled\(\)\) return;/.test(src),
  true,
);

// --- volume and length ceilings --------------------------------------------

const cueBlock = src.slice(src.indexOf("const CUES"), src.indexOf("let context"));
const gains = [...cueBlock.matchAll(/gain:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
const durations = [...cueBlock.matchAll(/duration:\s*([0-9.]+)/g)].map((m) => Number(m[1]));

check("both cues declare a gain", gains.length, 2);
check("both cues declare a duration", durations.length, 2);
check(
  "no cue exceeds 0.1 peak gain — these are confirmations, not alerts",
  gains.filter((g) => g > 0.1),
  [],
);
check(
  "no single tone runs longer than 0.2s",
  durations.filter((d) => d > 0.2),
  [],
);
check(
  "a full cue stays under a fifth of a second (two tones, back to back)",
  durations.filter((d) => d * 2 > 0.2),
  [],
);

// --- distinguishability ----------------------------------------------------
// Success rises, error falls. Someone not looking at the screen has to be
// able to tell them apart without learning a vocabulary.

const successFreq = /success:\s*\{\s*freq:\s*\[([0-9,\s]+)\]/.exec(src)?.[1];
const errorFreq = /error:\s*\{\s*freq:\s*\[([0-9,\s]+)\]/.exec(src)?.[1];
const parse = (s) => (s ?? "").split(",").map((n) => Number(n.trim()));

check("success rises in pitch", parse(successFreq)[1] > parse(successFreq)[0], true);
check("error falls in pitch", parse(errorFreq)[1] < parse(errorFreq)[0], true);
check(
  "error sits below success, so it never reads as a cheerier confirmation",
  Math.max(...parse(errorFreq)) < Math.min(...parse(successFreq)),
  true,
);

// --- failure containment ---------------------------------------------------
// Audio is a courtesy. It must never break the action that triggered it.

check(
  "playCue swallows every failure rather than surfacing it",
  /export function playCue[^]*?\}\s*catch\s*\{/.test(src),
  true,
);
check(
  "no audio files are fetched — tones are synthesised, so nothing to block or download",
  /\.mp3|\.wav|\.ogg|new Audio\(/.test(src),
  false,
);

// --- preview restores prior state ------------------------------------------

check(
  "previewing a cue does not silently leave cues switched on",
  /previewCue[^]*?if \(!wasEnabled\) setSoundCuesEnabled\(false\)/.test(src),
  true,
);

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll sound-cue tests passed.");
