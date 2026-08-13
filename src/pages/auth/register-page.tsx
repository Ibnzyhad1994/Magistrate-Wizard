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
import { registerSchema, type RegisterFormValues } from "@/lib/validations/auth";
import { ROUTES } from "@/routes/paths";
import { APP_NAME } from "@/lib/constants";

const fieldClassName =
  "h-12 rounded-sm border border-white/15 bg-[#333] text-white placeholder:text-white/50 focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-primary";

export default function RegisterPage() {
  const { signUp, isSigningUp } = useAuth();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: RegisterFormValues) {
    try {
      await signUp(values);
    } catch {
      // Errors surface globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Card className="border-0 bg-black/75 shadow-none">
      <CardHeader className="space-y-2 px-8 pt-10 sm:px-16 sm:pt-12">
        <CardTitle className="text-3xl font-bold tracking-tight text-white">
          Sign Up
        </CardTitle>
        <CardDescription className="text-white/70">
          Set up your {APP_NAME} account to start building your knowledge
          base.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-8 pb-10 sm:px-16 sm:pb-12">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Full name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Jane Doe"
                      autoComplete="name"
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
                  <FormLabel className="text-white/80">Password</FormLabel>
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
                  <FormLabel className="text-white/80">Confirm password</FormLabel>
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
              disabled={isSigningUp}
            >
              {isSigningUp && <LoadingSpinner className="text-current" size={16} />}
              Create account
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-sm text-white/70">
          Already have an account?{" "}
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
