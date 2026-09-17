import { Suspense, lazy, type ComponentProps } from "react";
import { LoadingRegion } from "@/components/common/loading-region";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { cn } from "@/lib/utils";

const RichTextEditorImpl = lazy(() =>
  import("@/components/common/rich-text-editor").then((m) => ({ default: m.RichTextEditor })),
);

type RichTextEditorProps = ComponentProps<typeof RichTextEditorImpl>;

/**
 * Code-split entry for the TipTap editor. TipTap plus ProseMirror is the
 * single heaviest dependency in the app and only the judgment and
 * bench-note detail pages mount it, so those pages import this wrapper
 * and the editor chunk is fetched the first time one of them renders.
 * Same props surface as `RichTextEditor`; everything is forwarded.
 */
export function RichTextEditorLazy(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <LoadingRegion
          label="Loading editor"
          className={cn(
            "flex min-h-[12rem] items-center justify-center rounded-md border border-input",
            props.className,
          )}
        >
          <LoadingSpinner />
        </LoadingRegion>
      }
    >
      <RichTextEditorImpl {...props} />
    </Suspense>
  );
}
