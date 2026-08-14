// Optional public court PDF fetch for Stage 8 of the brutal circuit.
// Cache under scripts/test-support/.cache/ (gitignored). Skip offline — not a failure.

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = join(__dirname, ".cache")

export const PUBLIC_FIXTURES = [
  {
    id: "ccj-2024-14-aj-gy",
    url: "https://ccj.org/wp-content/uploads/2024/06/2024_CCJ_14_AJ_GY.pdf",
    kind: "pdf",
    mustContain: ["Caribbean Court of Justice", "Guyana"],
  },
  {
    id: "ccj-2022-11-aj",
    url: "https://ccj.org/wp-content/uploads/2022/06/2022-CCJ-11-AJ.pdf",
    kind: "pdf",
    mustContain: ["Caribbean Court of Justice", "Guyana"],
  },
  {
    id: "jcpc-suraj-2021-0064",
    // Official JCPC uploads path (case page /judgment.pdf 404s).
    // No separate judgment HTML transcript — must-contain only (no CER vs case page chrome).
    url: "https://jcpc.uk/uploads/jcpc_2021_0064_judgment_bf81f7cbad.pdf",
    kind: "pdf",
    mustContain: ["Trinidad", "Tobago", "Privy Council"],
  },
]

const cachePath = (id, ext) => join(CACHE_DIR, `${id}.${ext}`)

const ensureCacheDir = () => {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

/**
 * Fetch a URL with a short timeout. Returns { ok, bytes|text, skipped, reason }.
 */
export const fetchCached = async (id, url, ext, timeoutMs = 20000) => {
  ensureCacheDir()
  const path = cachePath(id, ext)
  if (existsSync(path)) {
    const bytes = readFileSync(path)
    return { ok: true, bytes, path, fromCache: true }
  }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "MagistrateWizard-IngestCircuit/1.0 (local robustness test)" },
      redirect: "follow",
    })
    clearTimeout(timer)
    if (!res.ok) {
      return { ok: false, skipped: true, reason: `HTTP ${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(path, buf)
    return { ok: true, bytes: buf, path, fromCache: false }
  } catch (e) {
    return { ok: false, skipped: true, reason: e?.message ?? String(e) }
  }
}

export const stripHtmlToText = (html) => {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

/** In-repo workflow PDF — always available offline. */
export const IN_REPO_PDF = join(
  __dirname,
  "..",
  "..",
  "docs",
  "workflows-layman",
  "pdf",
  "00-how-to-read-these-guides.pdf",
)

export const IN_REPO_MUST_CONTAIN = ["How to read", "Magistrate Wizard"]
