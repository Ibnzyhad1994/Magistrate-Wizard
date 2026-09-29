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

/** Default is Compact: the most stills a row. */
export const DEFAULT_TILE_SIZE: TileSize = "compact";
export const DEFAULT_BROWSE_VIEW: BrowseView = "tiles";

/**
 * Tiles are 16:9 stills sized by columns, not by a fixed width. One table
 * gives the column count per screen width and tile size; the containers
 * (`TitleGallery`, `ContentRow`) read it through `stillColumnVars`, and
 * `.still-grid` / `.still-rail` in index.css switch columns at these
 * breakpoints. At every width Compact shows at least as many columns as
 * Regular and Regular at least as many as Large, and no still is narrower
 * than `STILL_MIN_WIDTH_PX` (npm run test:still-scale checks both).
 */
export const STILL_BREAKPOINTS = [
  ["base", 0],
  ["sm", 640],
  ["md", 768],
  ["lg", 1024],
  ["2xl", 1536],
] as const;

export const TILE_COLUMNS: Record<TileSize, readonly [number, number, number, number, number]> = {
  compact: [2, 3, 4, 5, 6],
  regular: [2, 2, 3, 4, 5],
  large: [1, 1, 2, 3, 4],
};

/** Space between stills, in a grid row and along a rail. */
export const STILL_GAP_PX = 12;
/** A rail still is this share of a gallery column, so the next one peeks. */
export const RAIL_STILL_SHARE = 0.9;
/** The narrowest a still may be: a 16-character case number fits on one line. */
export const STILL_MIN_WIDTH_PX = 136;

/** The column table for one tile size as CSS custom properties. */
export function stillColumnVars(size: TileSize): Record<string, string> {
  const vars: Record<string, string> = {
    "--still-gap": `${STILL_GAP_PX}px`,
    "--still-min": `${STILL_MIN_WIDTH_PX}px`,
    "--still-rail-share": String(RAIL_STILL_SHARE),
  };
  STILL_BREAKPOINTS.forEach(([name], i) => {
    vars[`--still-cols-${name}`] = String(TILE_COLUMNS[size][i]);
  });
  return vars;
}

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
