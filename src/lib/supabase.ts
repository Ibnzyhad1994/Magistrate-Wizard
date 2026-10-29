import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { AUTH_STORAGE_KEY, createAuthStorage } from "@/lib/auth/session-storage";

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
    // PKCE (BE-27): an Auth email link returns a one-time ?code=, never
    // tokens in the URL. AuthProvider exchanges it on the login and reset
    // routes only (auth-redirect.ts), so the URL is not scanned here; that
    // would also catch Google Calendar's ?code= on Settings.
    flowType: "pkce",
    detectSessionInUrl: false,
    storageKey: AUTH_STORAGE_KEY,
    storage: createAuthStorage(),
  },
});
