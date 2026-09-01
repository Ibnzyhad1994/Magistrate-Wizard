import { useEffect, useMemo, useRef, useState } from "react";
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
import { toast } from "sonner";
import {
  useDocketMatterCategories,
  useDocketCapacitySettings,
  useUpsertDocketCapacitySetting,
  useDeleteDocketCapacitySetting,
} from "@/hooks/docket/use-docket-capacity";

/**
 * Pure configuration — set once, applies to every date. No date picker,
 * no "preview utilisation for date": that belongs to the Docket page's
 * own always-visible capacity strip, not here.
 *
 * Every classification (including Other) has the same limit field.
 * Values persist on blur and again when the dialog closes, so the last
 * edited field is not lost when the Close control takes focus away
 * without a reliable blur.
 */
export function DocketCapacitySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: categories, isPending: categoriesPending } = useDocketMatterCategories();
  const { data: settings, isPending: settingsPending } = useDocketCapacitySettings();
  const upsert = useUpsertDocketCapacitySetting();
  const del = useDeleteDocketCapacitySetting();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const hydratedRef = useRef(false);

  const settingByCategory = useMemo(() => {
    const map = new Map<string, { id: string; daily_capacity: number }>();
    for (const s of settings ?? []) map.set(s.category_id, s);
    return map;
  }, [settings]);

  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return;
    }
    if (hydratedRef.current) return;
    if (categoriesPending || settingsPending) return;
    const next: Record<string, string> = {};
    for (const cat of categories ?? []) {
      const setting = settingByCategory.get(cat.id);
      next[cat.id] = setting ? String(setting.daily_capacity) : "";
    }
    setDrafts(next);
    hydratedRef.current = true;
  }, [open, categoriesPending, settingsPending, categories, settingByCategory]);

  const persistCategory = (categoryId: string, raw: string, silent: boolean) => {
    const trimmed = raw.trim();
    const setting = settingByCategory.get(categoryId);
    if (!trimmed) {
      if (!setting) return false;
      del.mutate({ id: setting.id, silent });
      return true;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) return false;
    if (setting?.daily_capacity === n) return false;
    upsert.mutate({ categoryId, dailyCapacity: n, silent });
    return true;
  };

  const handleDraftChange = (categoryId: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [categoryId]: value }));
  };

  const handleBlur = (categoryId: string) => {
    persistCategory(categoryId, drafts[categoryId] ?? "", false);
  };

  const handleKeyDown = (categoryId: string, key: string) => {
    if (key !== "Enter") return;
    persistCategory(categoryId, drafts[categoryId] ?? "", false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && hydratedRef.current) {
      let changed = false;
      for (const cat of categories ?? []) {
        if (persistCategory(cat.id, drafts[cat.id] ?? "", true)) changed = true;
      }
      if (changed) toast.success("Capacity saved.");
    }
    onOpenChange(nextOpen);
  };

  const handleClear = (categoryId: string) => {
    setDrafts((prev) => ({ ...prev, [categoryId]: "" }));
    const setting = settingByCategory.get(categoryId);
    if (setting) del.mutate({ id: setting.id });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Docket Capacity Settings</DialogTitle>
          <DialogDescription>
            Set a daily limit for every classification, including Other. This is personal to you:
            it never affects any other magistrate, and applies across every date. Leave a
            category blank for no limit. You can still add extra matters to a full date using
            &quot;Add Anyway&quot;; your normal setting here doesn&apos;t change.
          </DialogDescription>
        </DialogHeader>

        {categoriesPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-3">
            {(categories ?? []).map((cat) => {
              const setting = settingByCategory.get(cat.id);
              const draft = drafts[cat.id] ?? "";
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
                      value={draft}
                      placeholder="No limit"
                      aria-label={`Daily capacity for ${cat.name}`}
                      onChange={(e) => handleDraftChange(cat.id, e.target.value)}
                      onBlur={() => handleBlur(cat.id)}
                      onKeyDown={(e) => handleKeyDown(cat.id, e.key)}
                    />
                    {setting && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Clear capacity for ${cat.name}`}
                        disabled={del.isPending}
                        onClick={() => handleClear(cat.id)}
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
