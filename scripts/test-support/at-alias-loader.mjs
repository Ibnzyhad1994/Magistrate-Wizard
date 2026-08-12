// Minimal Node ESM loader hook that lets plain `node --experimental-strip-types`
// resolve the Vite `@/` path alias used throughout src/, so regression
// scripts under scripts/tests/ can import the REAL shipped TypeScript
// modules directly instead of maintaining separate inlined copies of the
// logic under test.
//
// `@/lib/supabase` specifically is redirected to a stub (see
// supabase-stub.mjs) — it throws at import time outside a real Vite/browser
// environment (reads `import.meta.env.VITE_SUPABASE_URL`, which does not
// exist under plain Node), and no test in scripts/tests/ needs a working
// Supabase client. This is a test-harness-only concern; no application code
// is touched or mocked in the shipped build.
//
// Register with: node --experimental-strip-types --import ./scripts/test-support/register.mjs <script>

const SRC_ROOT = new URL("../../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/supabase") {
    return nextResolve(new URL("./supabase-stub.mjs", import.meta.url).href, context);
  }
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    const target = new URL(`${rel}.ts`, SRC_ROOT).href;
    return nextResolve(target, context);
  }
  return nextResolve(specifier, context);
}
