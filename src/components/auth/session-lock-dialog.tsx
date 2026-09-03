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
  } = useAuth();
  const [password, setPassword] = useState("");
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

  return (
    <Dialog open>
      <DialogContent
        hideCloseButton
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        overlayClassName="z-[80]"
        className="z-[80] sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Session locked</DialogTitle>
          <DialogDescription>
            You have been inactive for an hour. Enter your password to keep
            this page — your work is still here.
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
              className="h-11 border-white/15 bg-[#333] text-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-lock-password">Password</Label>
            <Input
              id="session-lock-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              className="h-11 border-white/15 bg-[#333] text-white"
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={isReauthenticating || !password}
            >
              {isReauthenticating && (
                <LoadingSpinner className="text-current" size={16} />
              )}
              Continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full text-white/70"
              disabled={isSigningOut}
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
            <p className="text-center text-xs text-white/50">
              Signing out leaves this page and unsaved work will be lost.
            </p>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
