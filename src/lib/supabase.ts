import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Copy .env.example to .env and " +
      "set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

/**
 * Singleton Supabase client, typed against the generated database schema.
 * Import this everywhere instead of constructing new clients — Supabase
 * manages a single auth session per client instance.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "benchbook-auth",
  },
});
