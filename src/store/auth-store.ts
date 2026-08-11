import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/types/database.types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
}

interface AuthActions {
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setStatus: (status: AuthStatus) => void;
  reset: () => void;
}

const initialState: AuthState = {
  status: "loading",
  session: null,
  user: null,
  profile: null,
};

/**
 * Holds the mirrored auth session/profile so any component (not just ones
 * under a React Query provider) can read auth state synchronously. The
 * source of truth is Supabase; `AuthProvider` is the only writer to this
 * store — see `src/providers/auth-provider.tsx`.
 */
export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  ...initialState,
  setSession: (session) =>
    set({
      session,
      user: session?.user ?? null,
      status: session ? "authenticated" : "unauthenticated",
    }),
  setProfile: (profile) => set({ profile }),
  setStatus: (status) => set({ status }),
  reset: () => set(initialState),
}));
