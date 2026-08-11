import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
}

interface UiActions {
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

/**
 * Global UI chrome state (sidebar, mobile nav, command palette). Kept
 * separate from feature/domain state so it can persist across sessions
 * without pulling in anything Supabase-related.
 */
export const useUiStore = create<UiState & UiActions>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) =>
        set({ sidebarCollapsed: collapsed }),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: LOCAL_STORAGE_KEYS.sidebarCollapsed,
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
