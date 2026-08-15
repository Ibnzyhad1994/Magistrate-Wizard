export const BROWSE_VIEWS = ["tiles", "list"] as const;
export type BrowseView = (typeof BROWSE_VIEWS)[number];

export const TILE_SIZES = ["compact", "regular", "large"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export const BROWSE_VIEW_LABELS: Record<BrowseView, string> = {
  tiles: "Tiles",
  list: "List",
};

export const TILE_SIZE_LABELS: Record<TileSize, string> = {
  compact: "Compact",
  regular: "Regular",
  large: "Large",
};

/** Default is Compact — slightly smaller than the original poster tiles. */
export const DEFAULT_TILE_SIZE: TileSize = "compact";
export const DEFAULT_BROWSE_VIEW: BrowseView = "tiles";

export const TILE_WIDTH_CLASS: Record<TileSize, string> = {
  compact:
    "w-[32vw] min-w-[7.25rem] max-w-[10.5rem] sm:w-[20vw] md:w-[13vw] lg:w-[10vw] xl:w-[8.75vw]",
  regular:
    "w-[42vw] min-w-[9.5rem] max-w-[13.5rem] sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]",
  large:
    "w-[48vw] min-w-[11rem] max-w-[16rem] sm:w-[32vw] md:w-[22vw] lg:w-[16vw] xl:w-[14vw]",
};

export const LIST_THUMB_CLASS: Record<TileSize, string> = {
  compact: "h-[4.25rem] w-[2.85rem]",
  regular: "h-[5rem] w-[3.35rem]",
  large: "h-[6rem] w-16",
};

export function isBrowseView(value: unknown): value is BrowseView {
  return value === "tiles" || value === "list";
}

export function isTileSize(value: unknown): value is TileSize {
  return value === "compact" || value === "regular" || value === "large";
}
