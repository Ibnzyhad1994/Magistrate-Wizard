import { BookOpen, CircleHelp, FileText, Inbox, LogOut, Map, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { getInitials } from "@/lib/utils";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";
import { ThemeMenuSub } from "@/components/theme/theme-menu-sub";
import { useTour } from "@/components/tour/use-tour";

interface UserMenuProps {
  compact?: boolean;
}

export function UserMenu({ compact = false }: UserMenuProps) {
  const { user, profile, signOut, isSigningOut } = useAuth();
  const { data: hasApprovedMagistrateCourt } = useHasApprovedMagistrateCourt();
  const isPendingMagistrate =
    profile?.role === "magistrate" && hasApprovedMagistrateCourt === false;
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
            <AvatarFallback className="rounded-sm bg-primary text-xs font-bold text-primary-foreground">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          {!compact && (
            <span className="flex-1 truncate text-left text-sm font-medium">{displayName}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="truncate text-xs leading-none text-muted-foreground">{email}</p>
            {role && (
              <p className="text-xs leading-none text-muted-foreground">{ROLE_LABELS[role]}</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeMenuSub />
        {!isPendingMagistrate && (
          <DropdownMenuItem asChild>
            <Link to={ROUTES.notifications}>
              <Inbox />
              Notifications
            </Link>
          </DropdownMenuItem>
        )}
        {!isPendingMagistrate && (
          <DropdownMenuItem asChild>
            <Link to={ROUTES.settings}>
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
        )}
        {/* Static copies under public/help (training manual + the
            plain-language workflow guides), so help works offline and for
            a pending magistrate who cannot reach the rest of the app. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
            <CircleHelp />
            Help
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem asChild>
              <a href="/help/training-manual.pdf" target="_blank" rel="noopener noreferrer">
                <BookOpen />
                Training manual (PDF)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href="/help/guides/Magistrate-Wizard-Workflows-Plain-Language.pdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText />
                Plain-language guides (PDF)
              </a>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {canWalkthrough && (
          <DropdownMenuItem
            onSelect={() => {
              window.setTimeout(() => startWalkthrough(), 0);
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
