import { useEffect, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { PageLoader } from "@/components/common/page-loader";
import { toast } from "sonner";

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
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (!isMounted) return;

      if (error) {
        toast.error("Couldn't load your profile. Some features may be limited.");
        setProfile(null);
        return;
      }

      setProfile(data);
    }

    async function init() {
      setStatus("loading");
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setSession(session);
      if (session?.user) {
        void loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading") {
    return <PageLoader label="Loading BenchBook..." />;
  }

  return <>{children}</>;
}
