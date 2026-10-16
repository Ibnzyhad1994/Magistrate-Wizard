import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import {
  DEFAULT_BROWSE_VIEW,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILE_STYLE,
  isBrowseView,
  isTileSize,
  isTileStyle,
  type BrowseView,
  type TileSize,
  type TileStyle,
} from "@/lib/browse-prefs";

const DEFAULT_DOCKET_BROWSE_VIEW: BrowseView = "list";

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  browseView: BrowseView;
  docketBrowseView: BrowseView;
  tileSize: TileSize;
  tileStyle: TileStyle;
  /**
   * Remembered Docket scope: a court_id, or `null` for "All My Courts".
   * Purely a same-device convenience for a bare `/docket` visit with no
   * `?court=` param — never trusted on its own. docket-scope.ts always
   * re-validates it against the CURRENT signed-in user's actual current
   * court assignments before use, so a stale value (a different court,
   * or left over from a different account on a shared device) safely
   * falls back to All My Courts rather than ever being applied blindly.
   */
  lastDocketScope: string | null;
}

interface UiActions {
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setBrowseView: (view: BrowseView) => void;
  setDocketBrowseView: (view: BrowseView) => void;
  setTileSize: (size: TileSize) => void;
  setTileStyle: (style: TileStyle) => void;
  setLastDocketScope: (courtId: string | null) => void;
}

/**
 * Global UI chrome state (sidebar, mobile nav, browse display). Kept
 * separate from feature/domain state so it can persist across sessions
 * without pulling in anything Supabase-related.
 */
export const useUiStore = create<UiState & UiActions>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      browseView: DEFAULT_BROWSE_VIEW,
      docketBrowseView: DEFAULT_DOCKET_BROWSE_VIEW,
      tileSize: DEFAULT_TILE_SIZE,
      tileStyle: DEFAULT_TILE_STYLE,
      lastDocketScope: null,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setBrowseView: (view) => set({ browseView: view }),
      setDocketBrowseView: (view) => set({ docketBrowseView: view }),
      setTileSize: (size) => set({ tileSize: size }),
      setTileStyle: (style) => set({ tileStyle: style }),
      setLastDocketScope: (courtId) => set({ lastDocketScope: courtId }),
    }),
    {
      name: LOCAL_STORAGE_KEYS.sidebarCollapsed,
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        browseView: state.browseView,
        docketBrowseView: state.docketBrowseView,
        tileSize: state.tileSize,
        tileStyle: state.tileStyle,
        lastDocketScope: state.lastDocketScope,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...stored,
          browseView: isBrowseView(stored.browseView) ? stored.browseView : current.browseView,
          docketBrowseView: isBrowseView(stored.docketBrowseView)
            ? stored.docketBrowseView
            : current.docketBrowseView,
          tileSize: isTileSize(stored.tileSize) ? stored.tileSize : current.tileSize,
          tileStyle: isTileStyle(stored.tileStyle) ? stored.tileStyle : current.tileStyle,
          lastDocketScope:
            typeof stored.lastDocketScope === "string" ? stored.lastDocketScope : null,
        };
      },
    },
  ),
);
