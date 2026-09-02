import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme, type Theme } from "@/providers/use-theme";
import {
  BROWSE_VIEW_LABELS,
  TILE_SIZE_LABELS,
  isBrowseView,
  isTileSize,
} from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";
import { useAuth } from "@/hooks/use-auth";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { APP_BUILD, APP_VERSION } from "@/lib/app-version";
import { GoogleCalendarCard } from "@/pages/settings/google-calendar-card";
import { AdminSelfCourtCard } from "@/pages/settings/admin-self-court-card";
import { ROUTES } from "@/routes/paths";
import { useTour } from "@/components/tour/tour-provider";

export default function SettingsPage() {
  const browseView = useUiStore((s) => s.browseView);
  const setBrowseView = useUiStore((s) => s.setBrowseView);
  const tileSize = useUiStore((s) => s.tileSize);
  const setTileSize = useUiStore((s) => s.setTileSize);
  const { theme, setTheme } = useTheme();
  const { profile } = useAuth();
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const { canWalkthrough, startWalkthrough } = useTour();

  return (
    <BrowsePage>
      <BrowseHeader
        title="Settings"
        description="Display preferences for this device. Tile size and list or tile view apply across Docket, Case Law, and the other browse pages."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Display</CardTitle>
          <CardDescription>
            Compact is the default tile size. List view is a denser row layout of the same records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="browse-view">Browse layout</Label>
            <Select
              id="browse-view"
              className="max-w-xs"
              value={browseView}
              onChange={(e) => {
                if (isBrowseView(e.target.value)) setBrowseView(e.target.value);
              }}
              aria-label="Browse layout"
            >
              <option value="tiles">{BROWSE_VIEW_LABELS.tiles}</option>
              <option value="list">{BROWSE_VIEW_LABELS.list}</option>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Also available as a Tiles / List control on each browse page.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tile-size">Tile size</Label>
            <Select
              id="tile-size"
              className="max-w-xs"
              value={tileSize}
              onChange={(e) => {
                if (isTileSize(e.target.value)) setTileSize(e.target.value);
              }}
              aria-label="Tile size"
            >
              <option value="compact">{TILE_SIZE_LABELS.compact}</option>
              <option value="regular">{TILE_SIZE_LABELS.regular}</option>
              <option value="large">{TILE_SIZE_LABELS.large}</option>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Compact is slightly smaller than the original posters. Applies to tile view and Home rows.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="theme">Theme</Label>
            <Select
              id="theme"
              className="max-w-xs"
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              aria-label="Theme"
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {canWalkthrough && (
        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Help</CardTitle>
            <CardDescription>
              Take a 1-minute tour of Home, Docket, and the board.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" size="sm" onClick={startWalkthrough}>
              Start walkthrough
            </Button>
          </CardContent>
        </Card>
      )}

      {profile?.role === "admin" && <AdminSelfCourtCard />}

      {profile && profile.role !== "clerk" && profile.role !== "admin" && (
        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Court Assignments</CardTitle>
            <CardDescription>
              Platform role: <strong>{ROLE_LABELS[profile.role as UserRole]}</strong>. Docket
              access is separate from your platform role. It follows the
              active court assignments below, which an administrator
              manages under Court Assignments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {courtsPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : myCourts && myCourts.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {myCourts.map((c) => (
                  <li key={c.court_id} className="flex items-center gap-2">
                    <Landmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {c.court_name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                You do not currently have an active court assignment.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {profile?.role === "clerk" && (
        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Court Access</CardTitle>
            <CardDescription>View your access requests, or request another court.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to={ROUTES.clerkAccess}>
                Manage court access
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 space-y-6">
      <GoogleCalendarCard />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
          <CardDescription>
            Native shells (Android, iOS, Windows) share this version.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Version {APP_VERSION} (build {APP_BUILD})
          </p>
        </CardContent>
      </Card>
      </div>
    </BrowsePage>
  );
}
