import { useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { PageLoader } from "@/components/common/page-loader";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { isQueueableError } from "@/lib/offline/is-queueable-error";
import { getCachedProfile, hydrateOfflineStore, setCachedProfile } from "@/lib/offline/store";
import {
  isRecoveryAccessToken,
  readAuthCallback,
  urlWithoutAuthCallback,
} from "@/lib/auth/auth-redirect";
import { ROUTES } from "@/routes/paths";
import { setSentryUser } from "@/lib/sentry";

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Trades an Auth email return's one-time `?code=` for a session (PKCE,
 * BE-27) and clears every Auth parameter from the address bar, so a reload
 * cannot replay it. The client has detectSessionInUrl off, so this is the
 * only place a URL ever becomes a session. A failure on the login page is
 * told here; the reset page shows its own "link expired" card.
 */
async function completeAuthCallback() {
  const callback = readAuthCallback(window.location);
  if (!callback) return;
  window.history.replaceState(window.history.state, "", urlWithoutAuthCallback(window.location));
  if (callback.kind === "code") {
    const { flowId } = callback;
    const { error } = await supabase.auth.exchangeCodeForSession(
      callback.code,
      flowId ? { flowId } : undefined,
    );
    if (!error) return;
  }
  if (window.location.pathname === ROUTES.login) {
    toast.error(
      "That email link works only in the browser or app that asked for it. If you were confirming your email, sign in with your password.",
    );
  }
}

/**
 * Bootstraps the Supabase auth session on mount, subscribes to auth state
 * changes for the lifetime of the app, and keeps `useAuthStore` in sync.
 * Also loads the corresponding `profiles` row so role-based UI/routing
 * has what it needs without an extra round trip in every consumer.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const setSession = useAuthStore((state) => state.setSession);
  const setProfile = useAuthStore((state) => state.setProfile);
  const setStatus = useAuthStore((state) => state.setStatus);
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile(userId: string) {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (!isMounted) return;

        if (error) throw error;
        setProfile(data);
        await setCachedProfile(userId, data);
      } catch (error) {
        if (!isMounted) return;
        const cached = getCachedProfile(userId);
        if (cached && isQueueableError(error)) {
          setProfile(cached);
          return;
        }
        toast.error("Couldn't load your profile. Some features may be limited.");
        setProfile(null);
      }
    }

    async function init() {
      setStatus("loading");
      // Hydrating the offline store and restoring the session are
      // independent I/O; running them one after the other put a full
      // round of storage reads in front of the first paint for nothing.
      const [, sessionResult] = await Promise.all([
        hydrateOfflineStore(),
        completeAuthCallback().then(() => supabase.auth.getSession()),
      ]);

      if (!isMounted) return;

      const {
        data: { session },
        error,
      } = sessionResult;

      if (error) {
        toast.error("Couldn't restore your session. Please sign in again.");
        setSession(null);
        return;
      }

      // A password-recovery link's session is not a sign-in. Without this
      // check it would be promoted exactly like a normal login, which is
      // the bug: nothing would ever ask for a new password. Read from the
      // token rather than the URL, so a reload of the reset page (the
      // code is gone by then) is caught too. ResetPasswordPage reads the
      // same session directly via its own getSession() call, independent
      // of this store, so it still works.
      if (session && isRecoveryAccessToken(session.access_token)) {
        setSession(null);
        return;
      }

      setSession(session);
      setSentryUser(session?.user ? { id: session.user.id } : null);
      if (session?.user) {
        // Render the shell from the cached profile straight away and let
        // the network copy reconcile in the background. Without a cache
        // (first sign-in on this device) the profile is awaited as before
        // so role-gated routes never flash to /unauthorized.
        const cached = getCachedProfile(session.user.id);
        if (cached) {
          setProfile(cached);
          void loadProfile(session.user.id);
        } else {
          await loadProfile(session.user.id);
        }
      }
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      // A password-recovery link authenticates the Supabase client with a
      // one-time session so ResetPasswordPage can call updateUser() -- but
      // that must not be treated as a real sign-in. Before this branch
      // existed, this listener promoted it exactly like SIGNED_IN, so the
      // app never asked for a new password: it just logged the user back
      // in with the old (forgotten) one still active. Deliberately not
      // calling setSession/loadProfile here leaves global auth status
      // untouched (PublicRoute won't redirect ResetPasswordPage away, and
      // ProtectedRoute won't treat this as real access) -- the page reads
      // the recovery session itself via getSession(), independent of this
      // store, exactly like it would if this listener never fired at all.
      if (event === "PASSWORD_RECOVERY") return;
      // TOKEN_REFRESHED and USER_UPDATED carry the same recovery session,
      // so the check is on the session, not only the event.
      if (session && isRecoveryAccessToken(session.access_token)) return;
      if (!session) {
        // Local sign-out during idle lock must not wipe profile or bounce
        // ProtectedRoute to /login — that unmounts in-progress drafts.
        if (useAuthStore.getState().status === "locked") return;
        setSession(null);
        setProfile(null);
        setSentryUser(null);
        return;
      }
      // TOKEN_REFRESHED (or any non-password event) must not lift the lock
      // if local sign-out failed and a refresh token is still in storage.
      // Password re-auth is GoTrue SIGNED_IN.
      if (useAuthStore.getState().status === "locked" && event !== "SIGNED_IN") return;
      setSession(session);
      setSentryUser(session.user ? { id: session.user.id } : null);
      if (session.user) {
        void loadProfile(session.user.id);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading") {
    return <PageLoader label={`Loading ${APP_NAME}...`} />;
  }

  return <>{children}</>;
}
