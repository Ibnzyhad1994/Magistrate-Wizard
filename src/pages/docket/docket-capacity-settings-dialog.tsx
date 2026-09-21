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
import { DetailsHint } from "@/components/common/details-hint";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import {
  useDocketMatterCategories,
  useDocketCapacitySettings,
  useMyCapacityOverrides,
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

  // The Clear control is the one destructive action here (blanking the
  // field on blur is the same delete, but that is a deliberate edit; the
  // icon button is one stray click away), so it confirms first.
  const [pendingClear, setPendingClear] = useState<{
    id: string;
    name: string;
    categoryId: string;
  } | null>(null);

  const handleClear = (categoryId: string) => {
    const setting = settingByCategory.get(categoryId);
    if (!setting) {
      setDrafts((prev) => ({ ...prev, [categoryId]: "" }));
      return;
    }
    const name = (categories ?? []).find((c) => c.id === categoryId)?.name ?? "this classification";
    setPendingClear({ id: setting.id, name, categoryId });
  };

  const confirmClear = () => {
    if (!pendingClear) return;
    const { id, categoryId } = pendingClear;
    del.mutate(
      { id },
      {
        onSuccess: () => {
          setDrafts((prev) => ({ ...prev, [categoryId]: "" }));
          setPendingClear(null);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-0.5 pr-8">
            <DialogTitle>Docket Capacity Settings</DialogTitle>
            <DetailsHint
              label="More about capacity limits"
              details="Limits count the sittings you preside over, across all your courts. They're yours alone and don't affect other magistrates. You can still add to a full day with Add anyway."
            />
          </div>
          <DialogDescription>
            Set a daily limit for each type of matter. Leave blank for no limit.
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

        <OverrideHistory open={open} />
      </DialogContent>
      <AlertDialog
        open={!!pendingClear}
        onOpenChange={(open) => !open && setPendingClear(null)}
        title={
          pendingClear ? `Remove the daily limit for ${pendingClear.name}?` : "Remove this limit?"
        }
        description="This type will have no limit until you set one. Full days may stop showing as full."
        confirmLabel="Remove limit"
        isConfirming={del.isPending}
        onConfirm={confirmClear}
      />
    </Dialog>
  );
}

/**
 * Every deliberate over-capacity booking this magistrate acknowledged,
 * with the reason they gave. The rows have been recorded since 0077 and
 * shown nowhere, so a magistrate could not see their own pattern of
 * overloading a day -- which is the one thing a daily limit is supposed
 * to help with.
 *
 * Read-only: `docket_capacity_overrides` has no write policy for any
 * client role, so nothing here can edit or remove an entry.
 */
function OverrideHistory({ open }: { open: boolean }) {
  // Only fetched while the dialog is open; it is otherwise unmounted work
  // on a surface most sessions open to change a number and close.
  const { data, isPending } = useMyCapacityOverrides({ enabled: open });
  const rows = data ?? [];

  return (
    <section className="mt-6 border-t border-hairline pt-4 hc:border-border">
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-heading text-foreground">Times you went over</h3>
        <DetailsHint
          label="What this list shows"
          details="Each time you booked past your limit, the date, type, count and your reason were saved. Only you see this list, and it can't be edited."
        />
      </div>
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have not scheduled past a limit. Nothing to show.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const matter = relOne(row.docket_matters);
            const category = relOne(row.docket_matter_categories);
            return (
              <li key={row.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">
                  {formatDate(row.scheduled_date)}
                  {category?.name ? ` · ${category.name}` : ""} ·{" "}
                  <span className="tabular-nums">
                    {row.scheduled_count_at_override} of {row.configured_capacity}
                  </span>
                </p>
                {matter?.case_number ? (
                  <p className="text-xs text-muted-foreground">
                    {matter.case_number}
                    {matter.matter_title ? ` · ${matter.matter_title}` : ""}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.reason?.trim() ? row.reason : "No reason recorded."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** PostgREST returns an embedded row as an object or a one-element array. */
function relOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
