import { Select } from "@/components/ui/select";
import { BROWSE_VIEW_LABELS, isBrowseView, type BrowseView } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";

export function BrowseViewSelect({
  className,
  value,
  onChange,
}: {
  className?: string;
  value?: BrowseView;
  onChange?: (view: BrowseView) => void;
}) {
  const storedView = useUiStore((s) => s.browseView);
  const setStoredView = useUiStore((s) => s.setBrowseView);
  const browseView = value ?? storedView;

  return (
    <div className={className}>
      <Select
        className="w-[8.5rem]"
        value={browseView}
        onChange={(e) => {
          if (!isBrowseView(e.target.value)) return;
          if (onChange) onChange(e.target.value);
          else setStoredView(e.target.value);
        }}
        aria-label="Browse layout"
      >
        <option value="tiles">{BROWSE_VIEW_LABELS.tiles}</option>
        <option value="list">{BROWSE_VIEW_LABELS.list}</option>
      </Select>
    </div>
  );
}
