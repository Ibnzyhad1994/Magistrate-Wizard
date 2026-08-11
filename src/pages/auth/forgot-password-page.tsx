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
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            If an account exists for that email, we&apos;ve sent a link to
            reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to={ROUTES.login} className="text-sm font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@court.gov"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isResettingPassword}>
              {isResettingPassword && (
                <LoadingSpinner className="text-current" size={16} />
              )}
              Send reset link
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered it after all?{" "}
          <Link
            to={ROUTES.login}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
