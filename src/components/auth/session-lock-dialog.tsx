import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { PasswordInput } from "@/components/auth/password-input";
import { useAuth } from "@/hooks/use-auth";

/**
 * Blocking re-auth. The workspace behind this dialog stays mounted so
 * unsaved form state is not thrown away.
 */
export function SessionLockDialog() {
  const {
    user,
    profile,
    reauthenticate,
    isReauthenticating,
    signOut,
    isSigningOut,
    resetPassword,
    isResettingPassword,
  } = useAuth();
  const [password, setPassword] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const email = user?.email ?? profile?.email ?? "";

  async function handleContinue(event: FormEvent) {
    event.preventDefault();
    try {
      await reauthenticate(password);
      setPassword("");
    } catch {
      // Mutation cache toast already surfaced the error.
    }
  }

  async function handleForgotPassword() {
    if (!email) return;
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch {
      // Mutation cache toast already surfaced the error.
    }
  }

  return (
    <Dialog open>
      <DialogContent
        hideCloseButton
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        overlayClassName="z-lock"
        className="z-lock sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Session locked</DialogTitle>
          <DialogDescription>
            You&apos;ve been away for an hour. Enter your password to carry on. Your saves will
            sync, then the page reloads.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleContinue(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-lock-email">Email</Label>
            <Input
              id="session-lock-email"
              type="email"
              value={email}
              readOnly
              autoComplete="username"
              className="h-11 border-border bg-secondary text-foreground"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="session-lock-password">Password</Label>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs font-medium text-foreground/70"
                disabled={isResettingPassword || !email}
                onClick={() => void handleForgotPassword()}
              >
                {isResettingPassword
                  ? "Sending reset link…"
                  : resetSent
                    ? "Resend reset link"
                    : "Forgot password?"}
              </Button>
            </div>
            <PasswordInput
              id="session-lock-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the lock overlay exists only to take the password; focusing it is the expected next action
              autoFocus
              className="h-11 border-border bg-secondary text-foreground"
            />
            {resetSent ? (
              <p className="text-xs text-foreground/70">
                Check your email and open the link in a new tab. Set a new password, then enter it
                here. Keep this window open so you don&apos;t lose your work.
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={isReauthenticating || !password}
            >
              {isReauthenticating && <LoadingSpinner className="text-current" size={16} />}
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full text-foreground/70"
              disabled={isSigningOut}
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Signing out leaves this page and unsaved work will be lost.
            </p>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
