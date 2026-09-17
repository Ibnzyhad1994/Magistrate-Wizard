import {
  copyFileSync,
  cpSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const tesseractDir = join(publicDir, "tesseract");
const coreDir = join(root, "node_modules/tesseract.js-core");

mkdirSync(tesseractDir, { recursive: true });

const copies = [
  [
    join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    join(publicDir, "pdf.worker.min.mjs"),
  ],
  [join(root, "node_modules/tesseract.js/dist/worker.min.js"), join(tesseractDir, "worker.min.js")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn("skip missing", from);
    continue;
  }
  copyFileSync(from, to);
  console.log("copied", to);
}

// tesseract.js v7 with `corePath` pointing at a DIRECTORY (src/lib/ocr/
// engine.ts passes "/tesseract") loads exactly one file per device — see
// node_modules/tesseract.js/src/worker-script/browser/getCore.js:
//   * relaxed-SIMD, SIMD, or plain, chosen at runtime by wasm-feature-detect
//   * always the `-lstm` build, because engine.ts creates the worker with
//     OEM.LSTM_ONLY and never sets `legacyCore`
//   * always the `.wasm.js` (base64-embedded) form; the split `.js` +
//     `.wasm` pair is only used when a bundler resolves the core itself.
// Copying every variant put 43 MB into public/ for the three files that can
// actually be requested.
const CORE_FILES = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
];

if (existsSync(coreDir)) {
  for (const name of CORE_FILES) {
    const from = join(coreDir, name);
    if (!existsSync(from)) {
      console.warn("skip missing", from);
      continue;
    }
    copyFileSync(from, join(tesseractDir, name));
    console.log("copied", join(tesseractDir, name));
  }
  // public/tesseract is generated (gitignored); drop variants an earlier run
  // copied that the loader can never ask for.
  for (const name of readdirSync(tesseractDir)) {
    if (/^tesseract-core/.test(name) && !CORE_FILES.includes(name)) {
      rmSync(join(tesseractDir, name));
      console.log("removed unused", join(tesseractDir, name));
    }
  }
}

const cmapsSrc = join(root, "node_modules/pdfjs-dist/cmaps");
const fontsSrc = join(root, "node_modules/pdfjs-dist/standard_fonts");
if (existsSync(cmapsSrc)) {
  cpSync(cmapsSrc, join(publicDir, "cmaps"), { recursive: true });
  console.log("copied cmaps");
}
if (existsSync(fontsSrc)) {
  cpSync(fontsSrc, join(publicDir, "standard_fonts"), { recursive: true });
  console.log("copied standard_fonts");
}

const langUrl =
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz";
const langDest = join(tesseractDir, "eng.traineddata.gz");
if (existsSync(langDest)) {
  console.log("lang data already present");
} else {
  console.log("downloading", langUrl);
  const res = await fetch(langUrl);
  if (!res.ok) throw new Error(`Failed to download eng.traineddata.gz: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(langDest, buf);
  console.log("wrote", langDest, buf.length, "bytes");
}
