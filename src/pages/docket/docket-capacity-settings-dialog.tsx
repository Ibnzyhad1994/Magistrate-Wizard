import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { X } from "lucide-react";
import {
  useDocketMatterCategories,
  useDocketCapacitySettings,
  useUpsertDocketCapacitySetting,
  useDeleteDocketCapacitySetting,
} from "@/hooks/docket/use-docket-capacity";

/**
 * Pure configuration — set once, applies to every date. No date picker,
 * no "preview utilisation for date": that belongs to the Docket page's
 * own always-visible capacity strip, not here. Each input still saves
 * quietly on blur (no separate Save button to remember to click); this
 * screen is only reachable via the "Docket Capacity" button, so there is
 * no risk of an accidental edit going unnoticed.
 */
export function DocketCapacitySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: categories, isPending: categoriesPending } = useDocketMatterCategories();
  const { data: settings } = useDocketCapacitySettings();
  const upsert = useUpsertDocketCapacitySetting();
  const del = useDeleteDocketCapacitySetting();

  const settingByCategory = useMemo(() => {
    const map = new Map<string, { id: string; daily_capacity: number }>();
    for (const s of settings ?? []) map.set(s.category_id, s);
    return map;
  }, [settings]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Docket Capacity Settings</DialogTitle>
          <DialogDescription>
            Set your normal number of matters per day, per category. This is personal to you: it
            never affects any other magistrate, and applies across every date. Leave a category
            blank for no limit. You can still add extra matters to a full date using "Add Anyway";
            your normal setting here doesn't change.
          </DialogDescription>
        </DialogHeader>

        {categoriesPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-3">
            {(categories ?? []).map((cat) => {
              const setting = settingByCategory.get(cat.id);
              return (
                <div
                  key={cat.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <span className="text-sm font-medium text-foreground">{cat.name}</span>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="w-20"
                      defaultValue={setting?.daily_capacity ?? ""}
                      placeholder="No limit"
                      aria-label={`Daily capacity for ${cat.name}`}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (!raw) return;
                        const n = Number(raw);
                        if (!Number.isInteger(n) || n <= 0) return;
                        if (setting?.daily_capacity === n) return;
                        upsert.mutate({ categoryId: cat.id, dailyCapacity: n });
                      }}
                    />
                    {setting && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Clear capacity for ${cat.name}`}
                        disabled={del.isPending}
                        onClick={() => del.mutate(setting.id)}
                      >
                        {del.isPending ? <LoadingSpinner size={14} /> : <X className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
