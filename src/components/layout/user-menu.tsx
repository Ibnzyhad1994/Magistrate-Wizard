import { LogOut, Map, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { getInitials } from "@/lib/utils";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";
import { useTour } from "@/components/tour/tour-provider";

interface UserMenuProps {
  compact?: boolean;
}

export function UserMenu({ compact = false }: UserMenuProps) {
  const { user, profile, signOut, isSigningOut } = useAuth();
  const { data: hasApprovedMagistrateCourt } = useHasApprovedMagistrateCourt();
  const isPendingMagistrate = profile?.role === "magistrate" && hasApprovedMagistrateCourt === false;
  const { canWalkthrough, startWalkthrough } = useTour();

  const displayName = profile?.full_name ?? user?.email ?? "Account";
  const email = user?.email ?? "";
  const role = profile?.role as UserRole | undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={
            compact
              ? "h-11 w-11 shrink-0 rounded-sm p-0 hover:bg-transparent"
              : "h-9 w-full justify-start gap-2 px-2"
          }
          aria-label="Account menu"
        >
          <Avatar className={compact ? "h-8 w-8 rounded-sm" : "h-7 w-7"}>
            <AvatarImage src={profile?.avatar_url ?? undefined} alt={displayName} />
            <AvatarFallback className="rounded-sm bg-primary text-xs font-bold text-white">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          {!compact && (
            <span className="flex-1 truncate text-left text-sm font-medium">
              {displayName}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="truncate text-xs leading-none text-muted-foreground">
              {email}
            </p>
            {role && (
              <p className="text-xs leading-none text-muted-foreground">
                {ROLE_LABELS[role]}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!isPendingMagistrate && (
          <DropdownMenuItem asChild>
            <Link to={ROUTES.settings}>
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
        )}
        {canWalkthrough && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              startWalkthrough();
            }}
          >
            <Map />
            Guided walkthrough
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
          disabled={isSigningOut}
        >
          <LogOut />
          {isSigningOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
