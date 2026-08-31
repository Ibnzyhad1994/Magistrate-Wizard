import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  useSignupCourts,
  useSignupCourtsForMagistrate,
  useSignupMagisterialDistricts,
} from "@/hooks/docket/use-lookups";
import { registerSchema, type RegisterFormValues } from "@/lib/validations/auth";
import { ROUTES } from "@/routes/paths";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

const fieldClassName =
  "h-12 rounded-sm border border-white/15 bg-[#333] text-white placeholder:text-white/50 focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-primary";

export default function RegisterPage() {
  const { signUp, isSigningUp } = useAuth();
  const { data: districts } = useSignupMagisterialDistricts();
  const { data: clerkCourts } = useSignupCourts();
  const { data: magistrateCourts } = useSignupCourtsForMagistrate();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      accountType: "magistrate",
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
      staffId: "",
      districtId: "",
      courtIds: [],
      note: "",
    },
  });

  const accountType = form.watch("accountType");
  const districtId = form.watch("districtId");
  const courtIds = form.watch("courtIds") ?? [];
  const courtsInDistrict =
    accountType === "clerk"
      ? (clerkCourts ?? []).filter((c) => c.district_id === districtId)
      : (magistrateCourts ?? []).filter((c) => c.district_id === districtId);

  async function onSubmit(values: RegisterFormValues) {
    try {
      await signUp({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        ...(values.accountType === "clerk" ? { requestedRole: "clerk" as const } : {}),
        requestedCourtIds: values.courtIds,
        staffId: values.staffId,
        note: values.note,
      });
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
              name="accountType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Account type</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    {(["magistrate", "clerk"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => field.onChange(type)}
                        className={cn(
                          "rounded-sm border px-4 py-3 text-left text-sm font-medium transition-colors",
                          field.value === type
                            ? "border-primary bg-primary/10 text-white"
                            : "border-white/15 bg-[#333] text-white/70 hover:border-white/30",
                        )}
                        aria-pressed={field.value === type}
                      >
                        {type === "magistrate" ? "Magistrate" : "Court Clerk"}
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {accountType === "clerk" && (
              <p className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                Court access must be approved by the magistrate assigned to each
                court you request. You'll be able to sign in and check your
                request status once your email is verified, even before approval.
              </p>
            )}

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

            {accountType === "magistrate" && (
              <p className="rounded-sm border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                Selecting a court submits a request, not an immediate assignment. A Court
                Assignment Administrator reviews each requested court independently. You'll be
                able to sign in and check your request status once your email is verified, even
                before approval.
              </p>
            )}

            <FormField
              control={form.control}
              name="staffId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Staff / employee ID (optional)</FormLabel>
                  <FormControl>
                    <Input className={fieldClassName} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="districtId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">Magisterial District</FormLabel>
                  <FormControl>
                    <select
                      className={cn(fieldClassName, "w-full px-3")}
                      value={field.value ?? ""}
                      onChange={(e) => {
                        field.onChange(e.target.value);
                        form.setValue("courtIds", []);
                      }}
                    >
                      <option value="">Select a district…</option>
                      {(districts ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="courtIds"
              render={() => (
                <FormItem>
                  <FormLabel className="text-white/80">
                    {accountType === "clerk" ? "Court(s) you need access to" : "Court(s) you are requesting"}
                  </FormLabel>
                  <div className="space-y-2 rounded-sm border border-white/15 bg-[#333] p-3">
                    {!districtId ? (
                      <p className="text-sm text-white/50">Select a district first.</p>
                    ) : courtsInDistrict.length === 0 ? (
                      <p className="text-sm text-white/50">No courts found in this district.</p>
                    ) : (
                      courtsInDistrict.map((court) => {
                        const isAssigned =
                          accountType === "magistrate" &&
                          Boolean((court as { is_assigned?: boolean }).is_assigned);
                        return (
                          <label
                            key={court.id}
                            className={cn(
                              "flex items-center justify-between gap-2 text-sm",
                              isAssigned ? "text-white/35" : "text-white/80",
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <Checkbox
                                checked={courtIds.includes(court.id)}
                                disabled={isAssigned}
                                onCheckedChange={(checked) => {
                                  const next = checked
                                    ? [...courtIds, court.id]
                                    : courtIds.filter((id) => id !== court.id);
                                  form.setValue("courtIds", next, { shouldValidate: true });
                                }}
                              />
                              {court.name}
                            </span>
                            {isAssigned && (
                              <span className="text-[11px] uppercase tracking-wide text-white/40">
                                Assigned
                              </span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/80">
                    {accountType === "clerk"
                      ? "Note for the magistrate (optional)"
                      : "Note for the Court Assignment Administrator (optional)"}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={
                        accountType === "clerk"
                          ? "e.g. your clerk's office, or the magistrate you work with"
                          : "e.g. context for your request"
                      }
                      className="border border-white/15 bg-[#333] text-white placeholder:text-white/50"
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
