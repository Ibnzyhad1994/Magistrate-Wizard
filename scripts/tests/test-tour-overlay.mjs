import {
  tourCardPosition,
  tourCircleFromRect,
  tourFocusScrollDelta,
  tourTargetNeedsScroll,
} from "../../src/lib/tour-geometry.ts";

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

const small = tourCircleFromRect({ top: 100, left: 100, width: 40, height: 40 });
check("small target gets a circle at least as large as the control", small.size >= 48, true);
check(
  "small target circle is centered on the control",
  {
    left: Math.round(small.left + small.size / 2),
    top: Math.round(small.top + small.size / 2),
  },
  { left: 120, top: 120 },
);

const board = tourCircleFromRect({ top: 80, left: 16, width: 900, height: 420 });
check("large target circle stays capped", board.size <= 88, true);
check("large target circle stays on the visible start of the control", board.left < 16 + 80, true);
check("large target circle stays near the top of the control", board.top < 80 + 80, true);

const viewport = { width: 800, height: 600 };
const below = tourCardPosition({ top: 80, left: 200, size: 56 }, viewport, {
  width: 320,
  height: 176,
});
check("card sits below the circle when there is room", below.top >= 80 + 56, true);
check("card stays inside the viewport horizontally", below.left >= 16 && below.left + 320 <= 784, true);

const above = tourCardPosition({ top: 480, left: 200, size: 56 }, viewport, {
  width: 320,
  height: 176,
});
check("card sits above the circle when the bottom is tight", above.top + 176 <= 480, true);
check("card stays below the top of the viewport", above.top >= 16, true);

check(
  "target above the nav band needs a scroll",
  tourTargetNeedsScroll({ top: -120, left: 0, width: 200, height: 40 }, 800),
  true,
);
check(
  "target below the fold needs a scroll",
  tourTargetNeedsScroll({ top: 720, left: 0, width: 200, height: 40 }, 800),
  true,
);
check(
  "target already in the viewing band does not need a scroll",
  tourTargetNeedsScroll({ top: 160, left: 24, width: 120, height: 40 }, 800),
  false,
);
check(
  "low target scrolls far enough for the card to sit below",
  (() => {
    const rect = { top: 600, left: 0, width: 120, height: 48 };
    const delta = tourFocusScrollDelta(rect, 844);
    return rect.top - delta + rect.height < 844 - 200;
  })(),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
