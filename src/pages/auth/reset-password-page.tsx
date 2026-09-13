import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/lib/validations/auth";
import { ROUTES } from "@/routes/paths";
import { AUTH_PANEL_CLASS } from "@/components/theme/app-canvas";

const fieldClassName =
  "h-12 rounded-sm border border-foreground/15 bg-secondary text-foreground placeholder:text-foreground/50 focus-visible:border-foreground/30 focus-visible:ring-1 focus-visible:ring-primary";

const panelClassName = AUTH_PANEL_CLASS;
const headerClassName = "space-y-2 px-8 pt-10 sm:px-16 sm:pt-12";
const contentClassName = "px-8 pb-10 sm:px-16 sm:pb-12";

/**
 * Reached only from the "Reset your password" email link. That link
 * authenticates the Supabase client with a one-time recovery session --
 * AuthProvider deliberately never promotes it to a real app sign-in (see
 * its PASSWORD_RECOVERY handling), so this page reads that session
 * directly and independently, exactly as if the app-wide auth state
 * didn't exist. No session here means the link was never followed, has
 * already been used, or has expired -- not a login problem this page can
 * fix, so it points back to requesting a fresh one instead of a form
 * that would just fail.
 */
export default function ResetPasswordPage() {
  const { confirmPasswordReset, isConfirmingPasswordReset } = useAuth();
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setHasRecoverySession(Boolean(data.session));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ResetPasswordFormValues) {
    try {
      await confirmPasswordReset(values.password);
    } catch {
      // Errors surface globally via the mutation cache toast subscriber.
    }
  }

  if (hasRecoverySession === null) {
    return (
      <Card className={panelClassName}>
        <CardContent className={`${contentClassName} flex items-center justify-center py-16`}>
          <LoadingSpinner className="text-foreground/70" size={24} />
        </CardContent>
      </Card>
    );
  }

  if (!hasRecoverySession) {
    return (
      <Card className={panelClassName}>
        <CardHeader className={headerClassName}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
            Link expired
          </CardTitle>
          <CardDescription className="text-foreground/70">
            This password reset link is invalid or has already been used. Request a new one to
            continue.
          </CardDescription>
        </CardHeader>
        <CardContent className={contentClassName}>
          <Link
            to={ROUTES.forgotPassword}
            className="text-sm font-medium text-foreground/70 hover:underline"
          >
            Request a new link
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={panelClassName}>
      <CardHeader className={headerClassName}>
        <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
          Set a new password
        </CardTitle>
        <CardDescription className="text-foreground/70">
          Choose a new password for your account.
        </CardDescription>
      </CardHeader>
      <CardContent className={contentClassName}>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground/80">New password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      className={fieldClassName}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-foreground/80">Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      className={fieldClassName}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="mt-2 h-12 w-full text-base font-semibold"
              disabled={isConfirmingPasswordReset}
            >
              {isConfirmingPasswordReset && <LoadingSpinner className="text-current" size={16} />}
              Set new password
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
