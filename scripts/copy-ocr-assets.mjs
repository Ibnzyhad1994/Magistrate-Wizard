import { copyFileSync, cpSync, mkdirSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = join(root, "public")
const tesseractDir = join(publicDir, "tesseract")
const coreDir = join(root, "node_modules/tesseract.js-core")

mkdirSync(tesseractDir, { recursive: true })

const copies = [
  [join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), join(publicDir, "pdf.worker.min.mjs")],
  [join(root, "node_modules/tesseract.js/dist/worker.min.js"), join(tesseractDir, "worker.min.js")],
]

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn("skip missing", from)
    continue
  }
  copyFileSync(from, to)
  console.log("copied", to)
}

if (existsSync(coreDir)) {
  for (const name of readdirSync(coreDir)) {
    if (!/^tesseract-core/.test(name)) continue
    if (!/\.(js|wasm)$/.test(name)) continue
    copyFileSync(join(coreDir, name), join(tesseractDir, name))
    console.log("copied", join(tesseractDir, name))
  }
}

const cmapsSrc = join(root, "node_modules/pdfjs-dist/cmaps")
const fontsSrc = join(root, "node_modules/pdfjs-dist/standard_fonts")
if (existsSync(cmapsSrc)) {
  cpSync(cmapsSrc, join(publicDir, "cmaps"), { recursive: true })
  console.log("copied cmaps")
}
if (existsSync(fontsSrc)) {
  cpSync(fontsSrc, join(publicDir, "standard_fonts"), { recursive: true })
  console.log("copied standard_fonts")
}

const langUrl =
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz"
const langDest = join(tesseractDir, "eng.traineddata.gz")
if (existsSync(langDest)) {
  console.log("lang data already present")
} else {
  console.log("downloading", langUrl)
  const res = await fetch(langUrl)
  if (!res.ok) throw new Error(`Failed to download eng.traineddata.gz: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(langDest, buf)
  console.log("wrote", langDest, buf.length, "bytes")
}
