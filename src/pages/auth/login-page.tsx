import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { loginSchema, type LoginFormValues } from "@/lib/validations/auth";
import { ROUTES } from "@/routes/paths";
import { APP_NAME } from "@/lib/constants";

const fieldClassName =
  "h-12 rounded-sm border border-white/15 bg-[#333] text-white placeholder:text-white/50 focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-primary";

export default function LoginPage() {
  const { signIn, isSigningIn } = useAuth();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues) {
    try {
      await signIn(values);
    } catch {
      // Errors surface globally via the mutation cache toast subscriber
      // in src/lib/query-client.ts; nothing further to do here.
    }
  }

  return (
    <Card className="border-0 bg-black/75 shadow-none">
      <CardHeader className="space-y-2 px-8 pt-10 sm:px-16 sm:pt-12">
        <CardTitle className="text-3xl font-bold tracking-tight text-white">
          Sign In
        </CardTitle>
        <CardDescription className="text-white/70">
          Enter your credentials to access your {APP_NAME} workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-10 sm:px-16 sm:pb-12">
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

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-white/80">Password</FormLabel>
                    <Link
                      to={ROUTES.forgotPassword}
                      className="text-xs font-medium text-white/70 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
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
              disabled={isSigningIn}
            >
              {isSigningIn && <LoadingSpinner className="text-current" size={16} />}
              Sign In
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-sm text-white/70">
          Don&apos;t have an account?{" "}
          <Link
            to={ROUTES.register}
            className="font-medium text-white hover:underline"
          >
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
