import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import type { Profile } from "@/types/database.types";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "locked";

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
  lockSession: () => void;
  clearForSignOut: () => void;
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
 *
 * `locked` keeps user/profile so the workspace stays mounted (drafts
 * survive) after an idle timeout or expired JWT. Tokens are dropped
 * separately via local sign-out.
 */
export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  ...initialState,
  setSession: (session) =>
    set((state) => {
      if (session) {
        return {
          session,
          user: session.user ?? null,
          status: "authenticated" as const,
        };
      }
      if (state.status === "locked") {
        return { session: null };
      }
      return {
        session: null,
        user: null,
        status: "unauthenticated" as const,
      };
    }),
  setProfile: (profile) => set({ profile }),
  setStatus: (status) => set({ status }),
  lockSession: () =>
    set((state) => {
      if (state.status !== "authenticated") return state;
      return {
        status: "locked",
        session: null,
        user: state.user,
        profile: state.profile,
      };
    }),
  clearForSignOut: () =>
    set({
      status: "unauthenticated",
      session: null,
      user: null,
      profile: null,
    }),
  reset: () => set(initialState),
}));
