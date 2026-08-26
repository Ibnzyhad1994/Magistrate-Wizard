// Node has no DOM by default -- jsdom (devDependency, test-only, never
// shipped to the browser bundle) supplies one so DOMPurify can run
// headlessly, exactly how DOMPurify itself recommends testing it outside a
// browser. The browser code (docx-page-preview.ts) instead passes its own
// window-bound `import DOMPurify from "dompurify"` default export -- this
// test exercises the exact same sanitizeDocxPageBody/sanitizeDocxPageStyle
// functions with a jsdom-backed instance standing in for that.
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import {
  sanitizeDocxPageBody,
  sanitizeDocxPageStyle,
  stripNonDataCssUrls,
} from "../../src/lib/docx-page-preview-sanitize.ts";

const window = new JSDOM("").window;
const purify = createDOMPurify(window);

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures += 1;
}

// --- sanitizeDocxPageBody ---------------------------------------------------

{
  const out = sanitizeDocxPageBody('<script>alert(1)</script><p>hello</p>', purify);
  check("script tags are stripped entirely, not just neutralized", !out.includes("<script"));
  check("surrounding safe content survives", out.includes("<p>hello</p>"));
}

{
  const out = sanitizeDocxPageBody('<p onclick="alert(1)" style="color:red">hi</p>', purify);
  check("event handler attributes are stripped", !out.includes("onclick"));
  check("safe style attributes on an allowed tag survive (this preview's whole point)", out.includes('style="color:red"'));
}

{
  const out = sanitizeDocxPageBody('<img src="javascript:alert(1)">', purify);
  check("javascript: image src is stripped", !out.includes("javascript:"));
}

{
  const out = sanitizeDocxPageBody('<img src="data:image/png;base64,AAAA">', purify);
  check("data:image/ src is preserved (embedded images from useBase64URL)", out.includes("data:image/png;base64,AAAA"));
}

{
  const out = sanitizeDocxPageBody('<img src="https://evil.example/track.png">', purify);
  check("external https image src is stripped (no external resource loads)", !out.includes("evil.example"));
}

{
  const out = sanitizeDocxPageBody('<a href="javascript:alert(1)">click</a>', purify);
  check("javascript: link href is stripped", !out.includes("javascript:"));
}

{
  const out = sanitizeDocxPageBody('<a href="https://example.com/case.pdf">source</a>', purify);
  check("safe https link href survives", out.includes('href="https://example.com/case.pdf"'));
  check("safe links get rel=noopener noreferrer", out.includes("noopener"));
  check("safe links open in a new tab", out.includes('target="_blank"'));
}

{
  const out = sanitizeDocxPageBody('<a href="#footnote-1">1</a>', purify);
  check("fragment-only anchors (footnote/endnote refs) survive", out.includes('href="#footnote-1"'));
}

{
  const out = sanitizeDocxPageBody('<iframe src="https://evil.example"></iframe><p>ok</p>', purify);
  check("iframe is stripped even though not on the allowlist", !out.includes("<iframe"));
}

{
  const out = sanitizeDocxPageBody('<form><input type="text"></form><table><tr><td>cell</td></tr></table>', purify);
  check("form/input are stripped", !out.includes("<form") && !out.includes("<input"));
  check("legitimate table structure survives (Word tables must render)", out.includes("<table") && out.includes("<td>cell</td>"));
}

{
  const out = sanitizeDocxPageBody('<svg onload="alert(1)"><circle/></svg><p>ok</p>', purify);
  check("svg (forbidden -- known DOMPurify mXSS surface) is stripped", !out.includes("<svg"));
}

// --- stripNonDataCssUrls / sanitizeDocxPageStyle ----------------------------

{
  const css = "body{background:url(https://evil.example/pixel.png)}";
  const out = stripNonDataCssUrls(css);
  check("external CSS url() is neutered (no tracking-pixel style beacons)", !out.includes("evil.example"));
}

{
  const css = "@font-face{src:url(data:font/woff2;base64,AAAA)}";
  const out = stripNonDataCssUrls(css);
  check("data: CSS url() (embedded fonts/images, useBase64URL) survives", out.includes("data:font/woff2;base64,AAAA"));
}

{
  const styleMarkup = '<style>p{color:red}</style><script>alert(1)</script>';
  const out = sanitizeDocxPageStyle(styleMarkup, purify);
  check("a script sibling after the style tag is dropped", !out.includes("<script"));
  check("the style tag content survives", out.includes("color:red"));
}

{
  // A crafted "font-family" value attempting a </style> breakout followed by
  // an injected script -- must not survive as live markup.
  const styleMarkup = '<style>p{font-family:"</style><script>alert(1)</script>"}</style>';
  const out = sanitizeDocxPageStyle(styleMarkup, purify);
  check("a </style> breakout attempt does not leave an executable <script> in the output", !out.includes("<script>alert"));
}

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll docx-page-preview-sanitize tests passed.");
