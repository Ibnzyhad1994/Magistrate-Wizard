import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth-store";
import { ROUTES } from "@/routes/paths";
import { toast } from "sonner";
import { clearOfflineForProfile } from "@/lib/offline/store";

interface SignInParams {
  email: string;
  password: string;
}

interface SignUpParams {
  email: string;
  password: string;
  fullName: string;
}

/**
 * Primary auth API surface for the app. Reads reactive state from
 * `useAuthStore` (kept in sync by `AuthProvider`) and exposes mutations
 * for sign in / sign up / sign out / password reset. Components should
 * use this hook rather than calling `supabase.auth.*` directly so auth
 * side effects (navigation, toasts, cache clearing) stay centralized.
 */
export function useAuth() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const session = useAuthStore((state) => state.session);
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);

  const signInMutation = useMutation({
    mutationFn: async ({ email, password }: SignInParams) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Welcome back.");
      navigate(ROUTES.dashboard);
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async ({ email, password, fullName }: SignUpParams) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (!data.session) {
        toast.success("Check your email to confirm your account.");
        navigate(ROUTES.login);
        return;
      }
      toast.success("Account created.");
      navigate(ROUTES.dashboard);
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      const profileId = user?.id;
      queryClient.clear();
      if (profileId) void clearOfflineForProfile(profileId);
      navigate(ROUTES.login);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${ROUTES.login}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password reset email sent.");
    },
  });

  const hasRole = useCallback(
    (...roles: Array<NonNullable<typeof profile>["role"]>) =>
      profile ? roles.includes(profile.role) : false,
    [profile],
  );

  return {
    status,
    session,
    user,
    profile,
    isAuthenticated: status === "authenticated",
    isLoading: status === "loading",
    hasRole,
    signIn: signInMutation.mutateAsync,
    isSigningIn: signInMutation.isPending,
    signUp: signUpMutation.mutateAsync,
    isSigningUp: signUpMutation.isPending,
    signOut: signOutMutation.mutateAsync,
    isSigningOut: signOutMutation.isPending,
    resetPassword: resetPasswordMutation.mutateAsync,
    isResettingPassword: resetPasswordMutation.isPending,
  };
}
