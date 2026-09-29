import type { CSSProperties, ReactNode } from "react";
import { stillColumnVars, type BrowseView } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";

/**
 * A page's tiles: a grid of stills or posters whose column count comes from
 * the tile style, tile size and screen width (`COLUMNS_BY_STYLE`), or a
 * stack of rows in list view.
 * `layout` overrides the Settings view (the docket keeps its own).
 */
export function TitleGallery({ children, layout }: { children: ReactNode; layout?: BrowseView }) {
  const browseView = useUiStore((s) => s.browseView);
  const tileSize = useUiStore((s) => s.tileSize);
  const tileStyle = useUiStore((s) => s.tileStyle);

  if ((layout ?? browseView) === "list") {
    return <div className="flex flex-col gap-1.5 [&>*]:w-full">{children}</div>;
  }

  return (
    <div className="still-grid" style={stillColumnVars(tileSize, tileStyle) as CSSProperties}>
      {children}
    </div>
  );
}
