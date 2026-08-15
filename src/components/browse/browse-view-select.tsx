import { Select } from "@/components/ui/select";
import { BROWSE_VIEW_LABELS, isBrowseView } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";

export function BrowseViewSelect({ className }: { className?: string }) {
  const browseView = useUiStore((s) => s.browseView);
  const setBrowseView = useUiStore((s) => s.setBrowseView);

  return (
    <div className={className}>
      <Select
        className="w-[8.5rem]"
        value={browseView}
        onChange={(e) => {
          if (isBrowseView(e.target.value)) setBrowseView(e.target.value);
        }}
        aria-label="Browse layout"
      >
        <option value="tiles">{BROWSE_VIEW_LABELS.tiles}</option>
        <option value="list">{BROWSE_VIEW_LABELS.list}</option>
      </Select>
    </div>
  );
}
