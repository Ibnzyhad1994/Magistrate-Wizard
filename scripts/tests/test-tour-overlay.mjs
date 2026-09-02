import {
  padTourBox,
  tourCardPosition,
  tourCardPositionForPage,
  tourCircleFromRect,
  tourFocusScrollDelta,
  tourPageContentBox,
  tourTargetNeedsScroll,
  unionTourBoxes,
  visibleTourBox,
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

const header = tourCircleFromRect({ top: 400, left: 700, width: 104, height: 40 });
check("column header circle stays capped", header.size <= 120, true);
check(
  "column header circle is centered on the control",
  {
    left: Math.round(header.left + header.size / 2),
    top: Math.round(header.top + header.size / 2),
  },
  { left: 752, top: 420 },
);

const board = tourCircleFromRect({ top: 80, left: 16, width: 900, height: 420 });
check("large target circle stays capped", board.size <= 120, true);
check(
  "large target circle is centered on the control",
  {
    left: Math.round(board.left + board.size / 2),
    top: Math.round(board.top + board.size / 2),
  },
  { left: 466, top: 290 },
);

const clipped = visibleTourBox(
  { top: 80, left: 16, width: 900, height: 420 },
  { width: 800, height: 600 },
);
check("visible box clips a wide target to the viewport", clipped, {
  top: 80,
  left: 16,
  width: 784,
  height: 420,
});
const clippedCircle = tourCircleFromRect(clipped);
check(
  "circle on a clipped board sits in the visible middle",
  {
    left: Math.round(clippedCircle.left + clippedCircle.size / 2),
    top: Math.round(clippedCircle.top + clippedCircle.size / 2),
  },
  { left: 408, top: 290 },
);

const nextDateColumn = unionTourBoxes([
  { top: 400, left: 700, width: 104, height: 40 },
  { top: 440, left: 700, width: 104, height: 36 },
]);
check("next date header and first cell union into one column box", nextDateColumn, {
  top: 400,
  left: 700,
  width: 104,
  height: 76,
});
const nextDateCircle = tourCircleFromRect(nextDateColumn);
check(
  "next date circle is centered on the column, not the header corner",
  {
    left: Math.round(nextDateCircle.left + nextDateCircle.size / 2),
    top: Math.round(nextDateCircle.top + nextDateCircle.size / 2),
  },
  { left: 752, top: 438 },
);

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

const rightEdge = tourCardPosition({ top: 360, left: 720, size: 56 }, viewport, {
  width: 320,
  height: 176,
});
check(
  "card sits to the left of a right-edge circle",
  rightEdge.left + 320 <= 720,
  true,
);
check("right-edge card stays inside the viewport", rightEdge.left >= 16 && rightEdge.top >= 16, true);

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

const pageViewport = { width: 1280, height: 800 };
const pageContent = tourPageContentBox(68, pageViewport);
check("page hole starts below the navbar", pageContent, {
  top: 68,
  left: 0,
  width: 1280,
  height: 732,
});

const caseLawNav = padTourBox({ top: 22, left: 420, width: 72, height: 24 }, 8, pageViewport);
check("navbar hole is padded around the link", caseLawNav, {
  top: 14,
  left: 412,
  width: 88,
  height: 40,
});

const pageCardRight = tourCardPositionForPage(caseLawNav, pageViewport, { width: 320, height: 176 }, 68);
check("page card sits below the navbar", pageCardRight.top >= 80, true);
check(
  "page card stays off a left navbar link",
  pageCardRight.left >= caseLawNav.left + caseLawNav.width,
  true,
);

const searchNav = padTourBox({ top: 16, left: 1188, width: 44, height: 44 }, 8, pageViewport);
const pageCardLeft = tourCardPositionForPage(searchNav, pageViewport, { width: 320, height: 176 }, 68);
check(
  "page card stays off the search control",
  pageCardLeft.left + 320 <= searchNav.left,
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
