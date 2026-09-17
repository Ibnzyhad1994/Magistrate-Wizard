import { register } from "node:module";
register("./at-alias-loader.mjs", import.meta.url);

// pdf.js under Node needs its legacy build. src/lib/ocr/rasterize-pdf.ts and
// src/lib/redaction-pdf.ts look for this loader instead of importing the
// legacy entry themselves, so Vite never sees that import and the browser
// bundle carries exactly one copy of pdf.js.
globalThis.__MW_PDFJS_LOADER__ = () => import("pdfjs-dist/legacy/build/pdf.mjs");
