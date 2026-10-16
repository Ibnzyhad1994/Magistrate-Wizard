export const BROWSE_VIEWS = ["tiles", "list"] as const;
export type BrowseView = (typeof BROWSE_VIEWS)[number];

export const TILE_SIZES = ["compact", "regular", "large"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

/**
 * How a tile looks: a 16:9 still with the words below the art (the
 * default), or the earlier 2:3 poster with the words on the art.
 */
export const TILE_STYLES = ["stills", "posters"] as const;
export type TileStyle = (typeof TILE_STYLES)[number];

export const BROWSE_VIEW_LABELS: Record<BrowseView, string> = {
  tiles: "Tiles",
  list: "List",
};

export const TILE_SIZE_LABELS: Record<TileSize, string> = {
  compact: "Compact",
  regular: "Regular",
  large: "Large",
};

export const TILE_STYLE_LABELS: Record<TileStyle, string> = {
  stills: "Wide stills",
  posters: "Posters",
};

/** Default is Compact: the most tiles a row. */
export const DEFAULT_TILE_SIZE: TileSize = "compact";
export const DEFAULT_TILE_STYLE: TileStyle = "stills";
export const DEFAULT_BROWSE_VIEW: BrowseView = "tiles";

/**
 * Tiles are sized by columns, not by a fixed width. One table per tile
 * style gives the column count per screen width and tile size; the
 * containers (`TitleGallery`, `ContentRow`) read it through
 * `stillColumnVars`, and `.still-grid` / `.still-rail` in index.css switch
 * columns at these breakpoints. At every width Compact shows at least as
 * many columns as Regular and Regular at least as many as Large, and no
 * tile is narrower than `STILL_MIN_WIDTH_PX` (npm run test:still-scale and
 * npm run test:tile-style check both).
 */
export const STILL_BREAKPOINTS = [
  ["base", 0],
  ["sm", 640],
  ["md", 768],
  ["lg", 1024],
  ["xl", 1280],
  ["2xl", 1536],
] as const;

type ColumnRow = readonly [number, number, number, number, number, number];

/** 16:9 stills. They take no step at xl: that breakpoint is the posters'. */
export const TILE_COLUMNS: Record<TileSize, ColumnRow> = {
  compact: [2, 3, 4, 5, 5, 6],
  regular: [2, 2, 3, 4, 4, 5],
  large: [1, 1, 2, 3, 3, 4],
};

/**
 * 2:3 posters: narrower than a still, so more to a row. Compact is the most
 * a row can hold with every rail poster still at the floor, so on a phone
 * posters are two to a row at every size.
 */
export const POSTER_COLUMNS: Record<TileSize, ColumnRow> = {
  compact: [2, 3, 4, 5, 7, 8],
  regular: [2, 3, 3, 4, 6, 7],
  large: [2, 2, 3, 3, 5, 6],
};

export const COLUMNS_BY_STYLE: Record<TileStyle, Record<TileSize, ColumnRow>> = {
  stills: TILE_COLUMNS,
  posters: POSTER_COLUMNS,
};

/** Space between stills, in a grid row and along a rail. */
export const STILL_GAP_PX = 12;
/** A rail still is this share of a gallery column, so the next one peeks. */
export const RAIL_STILL_SHARE = 0.9;
/** The narrowest a tile may be: a 16-character case number fits on one line. */
export const STILL_MIN_WIDTH_PX = 136;

/** The column table for one tile size and style as CSS custom properties. */
export function stillColumnVars(
  size: TileSize,
  style: TileStyle = DEFAULT_TILE_STYLE,
): Record<string, string> {
  const vars: Record<string, string> = {
    "--still-gap": `${STILL_GAP_PX}px`,
    "--still-min": `${STILL_MIN_WIDTH_PX}px`,
    "--still-rail-share": String(RAIL_STILL_SHARE),
  };
  STILL_BREAKPOINTS.forEach(([name], i) => {
    vars[`--still-cols-${name}`] = String(COLUMNS_BY_STYLE[style][size][i]);
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

export function isTileStyle(value: unknown): value is TileStyle {
  return value === "stills" || value === "posters";
}
