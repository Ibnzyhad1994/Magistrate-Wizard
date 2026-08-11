import { LogOut, Settings, User as UserIcon } from "lucide-react";
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
import { getInitials } from "@/lib/utils";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";

export function UserMenu() {
  const { user, profile, signOut, isSigningOut } = useAuth();

  const displayName = profile?.full_name ?? user?.email ?? "Account";
  const email = user?.email ?? "";
  const role = profile?.role as UserRole | undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2"
        >
          <Avatar className="h-7 w-7">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt={displayName} />
            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-left text-sm font-medium">
            {displayName}
          </span>
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
        <DropdownMenuItem disabled>
          <UserIcon />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
