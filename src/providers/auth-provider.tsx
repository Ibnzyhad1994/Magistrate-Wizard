import { useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { PageLoader } from "@/components/common/page-loader";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { isQueueableError } from "@/lib/offline/is-queueable-error";
import { getCachedProfile, hydrateOfflineStore, setCachedProfile } from "@/lib/offline/store";
import { isPasswordRecoveryUrl } from "@/lib/auth/session-policy";

interface AuthProviderProps {
  children: ReactNode;
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
      await hydrateOfflineStore();

      // Supabase's client parses a password-recovery link's URL fragment
      // (#access_token=...&type=recovery&...) into a real session during
      // its own internal initialization, before this effect even runs --
      // confirmed against a real recovery email in this app's configured
      // (implicit) flow. Without this check, the getSession() call below
      // would pick that session up and promote it exactly like a normal
      // login, which is the bug: nothing would ever ask for a new
      // password. ResetPasswordPage reads the same session directly via
      // its own getSession() call, independent of this store, so it still
      // works -- this only stops the app treating it as a real sign-in.
      if (isPasswordRecoveryUrl(window.location.hash, window.location.search)) {
        if (isMounted) setSession(null);
        return;
      }

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (error) {
        toast.error("Couldn't restore your session. Please sign in again.");
        setSession(null);
        return;
      }

      setSession(session);
      if (session?.user) {
        await loadProfile(session.user.id);
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
      if (!session) {
        // Local sign-out during idle lock must not wipe profile or bounce
        // ProtectedRoute to /login — that unmounts in-progress drafts.
        if (useAuthStore.getState().status === "locked") return;
        setSession(null);
        setProfile(null);
        return;
      }
      setSession(session);
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
