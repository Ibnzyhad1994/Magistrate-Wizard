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
}

interface UiActions {
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setBrowseView: (view: BrowseView) => void;
  setDocketBrowseView: (view: BrowseView) => void;
  setTileSize: (size: TileSize) => void;
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
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setBrowseView: (view) => set({ browseView: view }),
      setDocketBrowseView: (view) => set({ docketBrowseView: view }),
      setTileSize: (size) => set({ tileSize: size }),
    }),
    {
      name: LOCAL_STORAGE_KEYS.sidebarCollapsed,
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        browseView: state.browseView,
        docketBrowseView: state.docketBrowseView,
        tileSize: state.tileSize,
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
        };
      },
    },
  ),
);
