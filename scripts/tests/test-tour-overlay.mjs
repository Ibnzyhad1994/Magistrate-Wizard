import {
  padTourBox,
  tourCardPosition,
  tourCardPositionForPage,
  tourFocusScrollDelta,
  tourPageContentBox,
  tourSpotlightFromRect,
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

// --- spotlight shape follows the target ------------------------------------
// A circle is right for a button or a single cell. It is wrong for a board,
// a tab strip, or a table column: the old always-a-circle behaviour drew a
// 120px disc in the middle of a 900x420 element, highlighting nothing, and
// bled well above and below a 40px-tall column header. These assertions
// pin the shape decision so that cannot come back.

const centreOf = (spot) => ({
  left: Math.round(spot.left + spot.width / 2),
  top: Math.round(spot.top + spot.height / 2),
});
const isCircle = (spot) => spot.width === spot.height && spot.radius === spot.width / 2;

const small = tourSpotlightFromRect({ top: 100, left: 100, width: 40, height: 40 });
check("a small square target still gets a circle", isCircle(small), true);
check("small target circle is at least as large as the control", small.width >= 48, true);
check("small target circle is centred on the control", centreOf(small), { left: 120, top: 120 });

const tiny = tourSpotlightFromRect({ top: 100, left: 100, width: 12, height: 12 });
check("a tiny target is grown to the minimum circle, not left invisible", tiny.width, 48);
check("tiny target circle is still centred on it", centreOf(tiny), { left: 106, top: 106 });

// 104x40 padded is 124x60 — over the 120 cap, so this becomes a rounded
// rect that actually covers the header instead of a disc spilling past it.
const header = tourSpotlightFromRect({ top: 400, left: 700, width: 104, height: 40 });
check("a wide column header is not forced into a circle", isCircle(header), false);
check("column header spotlight hugs the header's real bounds", header, {
  top: 390,
  left: 690,
  width: 124,
  height: 60,
  radius: 14,
});

// 90x14 padded is 110x34: under the 120 cap, but 3.2:1 — a circle there
// would be almost entirely empty space above and below a thin strip.
const strip = tourSpotlightFromRect({ top: 200, left: 300, width: 90, height: 14 });
check("a thin strip under the size cap is still rejected on aspect", isCircle(strip), false);
check("thin strip radius never exceeds half its short side", strip.radius <= strip.height / 2, true);

const board = tourSpotlightFromRect({ top: 80, left: 16, width: 900, height: 420 });
check("the board gets a rectangle, not a disc floating in its middle", isCircle(board), false);
check("board spotlight covers the whole board", board, {
  top: 70,
  left: 6,
  width: 920,
  height: 440,
  radius: 14,
});

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
const clippedSpot = tourSpotlightFromRect(clipped);
check("spotlight on a clipped board follows the visible part", clippedSpot, {
  top: 70,
  left: 6,
  width: 804,
  height: 440,
  radius: 14,
});

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
const nextDateSpot = tourSpotlightFromRect(nextDateColumn);
check("next date spotlight covers the column, header and cell alike", nextDateSpot, {
  top: 390,
  left: 690,
  width: 124,
  height: 96,
  radius: 14,
});

// --- card placement --------------------------------------------------------

const viewport = { width: 800, height: 600 };
const below = tourCardPosition({ top: 80, left: 200, width: 56, height: 56 }, viewport, {
  width: 320,
  height: 176,
});
check("card sits below the spotlight when there is room", below.top >= 80 + 56, true);
check("card stays inside the viewport horizontally", below.left >= 16 && below.left + 320 <= 784, true);

const above = tourCardPosition({ top: 480, left: 200, width: 56, height: 56 }, viewport, {
  width: 320,
  height: 176,
});
check("card sits above the spotlight when the bottom is tight", above.top + 176 <= 480, true);
check("card stays below the top of the viewport", above.top >= 16, true);

const rightEdge = tourCardPosition({ top: 360, left: 720, width: 56, height: 56 }, viewport, {
  width: 320,
  height: 176,
});
check("card sits to the left of a right-edge spotlight", rightEdge.left + 320 <= 720, true);
check("right-edge card stays inside the viewport", rightEdge.left >= 16 && rightEdge.top >= 16, true);

// A wide spotlight has to push the card further than a 56px circle would.
// Passing the box (not a nominal circle) is the whole point of the change.
const wide = tourCardPosition({ top: 80, left: 40, width: 700, height: 120 }, viewport, {
  width: 320,
  height: 176,
});
check("card clears the full height of a wide spotlight", wide.top >= 80 + 120, true);

// When the spotlight leaves no clear side at all, the card must still land
// somewhere readable rather than dead centre on the target.
const noRoom = tourCardPosition(board, viewport, { width: 320, height: 176 });
check(
  "card with no clear side is still fully on screen",
  noRoom.top >= 16 &&
    noRoom.left >= 16 &&
    noRoom.top + 176 <= 600 - 16 &&
    noRoom.left + 320 <= 800 - 16,
  true,
);

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
