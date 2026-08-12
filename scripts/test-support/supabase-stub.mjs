// Test-only stand-in for `@/lib/supabase`, used exclusively by the
// at-alias-loader when running scripts/tests/*.mjs under plain Node (see
// at-alias-loader.mjs for why the real module can't load there). Nothing
// under scripts/tests/ calls a Supabase method — this only needs to exist
// so `import { supabase } from "@/lib/supabase"` has something to bind to
// inside legal-extraction.ts.
export const supabase = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "supabase stub: this test harness never expects a real Supabase call — " +
          "if you see this, the function under test now depends on the network client " +
          "and needs a real integration test instead.",
      );
    },
  },
);
