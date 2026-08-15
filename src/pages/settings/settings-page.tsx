import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme, type Theme } from "@/providers/theme-provider";
import {
  BROWSE_VIEW_LABELS,
  TILE_SIZE_LABELS,
  isBrowseView,
  isTileSize,
} from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";

export default function SettingsPage() {
  const browseView = useUiStore((s) => s.browseView);
  const setBrowseView = useUiStore((s) => s.setBrowseView);
  const tileSize = useUiStore((s) => s.tileSize);
  const setTileSize = useUiStore((s) => s.setTileSize);
  const { theme, setTheme } = useTheme();

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
    </BrowsePage>
  );
}
