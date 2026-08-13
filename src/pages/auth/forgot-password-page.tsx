import { useState } from "react";
import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CheckCircle2 } from "lucide-react";
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
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from "@/lib/validations/auth";
import { ROUTES } from "@/routes/paths";

const fieldClassName =
  "h-12 rounded-sm border border-white/15 bg-[#333] text-white placeholder:text-white/50 focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-primary";

const panelClassName = "border-0 bg-black/75 shadow-none";
const headerClassName = "space-y-2 px-8 pt-10 sm:px-16 sm:pt-12";
const contentClassName = "px-8 pb-10 sm:px-16 sm:pb-12";

export default function ForgotPasswordPage() {
  const { resetPassword, isResettingPassword } = useAuth();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    try {
      await resetPassword(values.email);
      setSubmitted(true);
    } catch {
      // Errors surface globally via the mutation cache toast subscriber.
    }
  }

  if (submitted) {
    return (
      <Card className={panelClassName}>
        <CardHeader className={headerClassName}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-white">
            Check your email
          </CardTitle>
          <CardDescription className="text-white/70">
            If an account exists for that email, we&apos;ve sent a link to
            reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent className={contentClassName}>
          <Link
            to={ROUTES.login}
            className="text-sm font-medium text-white/70 hover:underline"
          >
            Back to Sign In
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={panelClassName}>
      <CardHeader className={headerClassName}>
        <CardTitle className="text-3xl font-bold tracking-tight text-white">
          Forgot Password
        </CardTitle>
        <CardDescription className="text-white/70">
          Enter your account email and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent className={contentClassName}>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@court.gov"
                      autoComplete="email"
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
              disabled={isResettingPassword}
            >
              {isResettingPassword && (
                <LoadingSpinner className="text-current" size={16} />
              )}
              Send reset link
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-sm text-white/70">
          Remembered it after all?{" "}
          <Link
            to={ROUTES.login}
            className="font-medium text-white hover:underline"
          >
            Sign In
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
