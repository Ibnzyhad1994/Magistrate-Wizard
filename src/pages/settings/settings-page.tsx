import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ThemeSelect } from "@/components/theme/theme-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BROWSE_VIEW_LABELS, TILE_SIZE_LABELS, isBrowseView, isTileSize } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";
import { useAuth } from "@/hooks/use-auth";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { APP_BUILD, APP_VERSION } from "@/lib/app-version";
import { GoogleCalendarCard } from "@/pages/settings/google-calendar-card";
import { AdminSelfCourtCard } from "@/pages/settings/admin-self-court-card";
import {
  DownloadMyDataCard,
  HearingRemindersCard,
  SoundCuesCard,
} from "@/pages/settings/privacy-and-reminders-cards";
import { ROUTES } from "@/routes/paths";
import { useTour } from "@/components/tour/use-tour";
import { FeatureFlag } from "@/components/common/feature-flag";
import { useFeatureFlag } from "@/hooks/use-feature-flags";
import { DispatchCard } from "@/pages/settings/dispatch-card";

/**
 * Side index for the settings column. Anchors, not tabs: every card stays
 * on one page so a magistrate can scroll it end to end, and the index is
 * a shortcut for the ones who know what they came for.
 */
const SECTIONS = [
  { id: "display", label: "Display" },
  { id: "help", label: "Help" },
  { id: "courts", label: "Courts" },
  { id: "dispatch", label: "Dispatch" },
  { id: "calendar", label: "Calendar" },
  { id: "sound", label: "Sound" },
  { id: "reminders", label: "Reminders" },
  { id: "data", label: "Your data" },
  { id: "about", label: "About" },
] as const;

function SettingsIndex({ visible }: { visible: ReadonlySet<string> }) {
  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <ul className="sticky top-[calc(68px+env(safe-area-inset-top)+1.5rem)] space-y-1">
        {SECTIONS.filter((section) => visible.has(section.id)).map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block rounded-sm px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SettingsSection({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-[calc(68px+env(safe-area-inset-top)+1rem)]">
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const browseView = useUiStore((s) => s.browseView);
  const setBrowseView = useUiStore((s) => s.setBrowseView);
  const tileSize = useUiStore((s) => s.tileSize);
  const setTileSize = useUiStore((s) => s.setTileSize);
  const { profile } = useAuth();
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const { canWalkthrough, startWalkthrough } = useTour();
  const showCourts = Boolean(profile);
  const dispatch = useFeatureFlag("matter_portable_bundle");
  const visibleSections = new Set<string>([
    "display",
    ...(canWalkthrough ? ["help"] : []),
    ...(showCourts ? ["courts"] : []),
    ...(dispatch.enabled ? ["dispatch"] : []),
    "calendar",
    "sound",
    "reminders",
    "data",
    "about",
  ]);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Settings"
        description="Display preferences for this device. Tile size and list or tile view apply across Docket, Case Law, and the other browse pages."
      />

      <div className="grid gap-10 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <SettingsIndex visible={visibleSections} />
        <div className="max-w-3xl space-y-6">
          <SettingsSection id="display">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Display</CardTitle>
                <CardDescription>
                  Compact is the default tile size. List view is a denser row layout of the same
                  records.
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
                    Compact is slightly smaller than the original posters. Applies to tile view and
                    Home rows.
                  </p>
                </div>

                <ThemeSelect id="theme" />
              </CardContent>
            </Card>
          </SettingsSection>

          {canWalkthrough && (
            <SettingsSection id="help">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Help</CardTitle>
                  <CardDescription>
                    Magistrates see this once after they are assigned to a court. Start it again any
                    time from here or the account menu.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button type="button" variant="outline" size="sm" onClick={startWalkthrough}>
                    Start walkthrough
                  </Button>
                </CardContent>
              </Card>
            </SettingsSection>
          )}

          {showCourts && (
            <SettingsSection id="courts">
              {profile?.role === "admin" && <AdminSelfCourtCard />}

              {profile && profile.role !== "clerk" && profile.role !== "admin" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Court Assignments</CardTitle>
                    {/* Court assignment became self-service (request / relinquish,
                with a Court Assignment Administrator approving) — this card
                still described the old admin-only model, and named Court
                Assignments without linking to it. */}
                    <CardDescription>
                      Platform role: <strong>{ROLE_LABELS[profile.role as UserRole]}</strong>. Your
                      docket access comes from your court seats below. Request or give them up under
                      Court Assignments.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
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
                        You do not currently have an active court seating.
                      </p>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <Link to={ROUTES.courtAssignments}>
                        {myCourts && myCourts.length > 0
                          ? "Manage court assignments"
                          : "Request a court"}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )}

              {profile?.role === "clerk" && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Court Access</CardTitle>
                    <CardDescription>
                      View your access requests, or request another court.
                    </CardDescription>
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
            </SettingsSection>
          )}

          <FeatureFlag flag="matter_portable_bundle">
            <SettingsSection id="dispatch">
              <DispatchCard />
            </SettingsSection>
          </FeatureFlag>

          <SettingsSection id="calendar">
            <GoogleCalendarCard />
          </SettingsSection>
          <SettingsSection id="sound">
            <SoundCuesCard />
          </SettingsSection>
          <SettingsSection id="reminders">
            <HearingRemindersCard />
          </SettingsSection>
          <SettingsSection id="data">
            <DownloadMyDataCard />
          </SettingsSection>

          <SettingsSection id="about">
            <Card>
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
          </SettingsSection>
        </div>
      </div>
    </BrowsePage>
  );
}
