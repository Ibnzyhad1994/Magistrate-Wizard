import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import {
  DEFAULT_BROWSE_VIEW,
  DEFAULT_TILE_SIZE,
  isBrowseView,
  isTileSize,
  type BrowseView,
  type TileSize,
} from "@/lib/browse-prefs";

const DEFAULT_DOCKET_BROWSE_VIEW: BrowseView = "list";

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  browseView: BrowseView;
  docketBrowseView: BrowseView;
  tileSize: TileSize;
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
  setCommandPaletteOpen: (open: boolean) => void;
  setBrowseView: (view: BrowseView) => void;
  setDocketBrowseView: (view: BrowseView) => void;
  setTileSize: (size: TileSize) => void;
  setLastDocketScope: (courtId: string | null) => void;
}

/**
 * Global UI chrome state (sidebar, mobile nav, command palette, browse
 * display). Kept separate from feature/domain state so it can persist
 * across sessions without pulling in anything Supabase-related.
 */
export const useUiStore = create<UiState & UiActions>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      browseView: DEFAULT_BROWSE_VIEW,
      docketBrowseView: DEFAULT_DOCKET_BROWSE_VIEW,
      tileSize: DEFAULT_TILE_SIZE,
      lastDocketScope: null,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setBrowseView: (view) => set({ browseView: view }),
      setDocketBrowseView: (view) => set({ docketBrowseView: view }),
      setTileSize: (size) => set({ tileSize: size }),
      setLastDocketScope: (courtId) => set({ lastDocketScope: courtId }),
    }),
    {
      name: LOCAL_STORAGE_KEYS.sidebarCollapsed,
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        browseView: state.browseView,
        docketBrowseView: state.docketBrowseView,
        tileSize: state.tileSize,
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
          lastDocketScope: typeof stored.lastDocketScope === "string" ? stored.lastDocketScope : null,
        };
      },
    },
  ),
);
