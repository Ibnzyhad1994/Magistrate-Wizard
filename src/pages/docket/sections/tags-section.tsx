import { useState } from "react";
import { Tag as TagIcon, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { TagInput } from "@/components/common/tag-input";
import {
  useAddDocketTag,
  useDocketTags,
  useRemoveDocketTag,
} from "@/hooks/docket/use-docket-tags";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";

interface TagsSectionProps {
  matterId: string;
  frozen?: boolean;
}

export function TagsSection({ matterId, frozen = false }: TagsSectionProps) {
  const { data, isPending, isError, error, refetch } = useDocketTags(matterId);
  const { data: access } = useDocketMatterAccess(matterId);
  const canEdit = (access?.canEdit ?? false) && !frozen;
  const addTag = useAddDocketTag(matterId);
  const removeTag = useRemoveDocketTag(matterId);
  const [value, setValue] = useState("");

  const handleAdd = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    addTag.mutate(trimmed, { onSuccess: () => setValue("") });
  };

  return (
    <div className="mt-4 space-y-4">
      {canEdit && (
        <div className="flex max-w-sm gap-2">
          <TagInput value={value} onChange={setValue} onSubmit={handleAdd} disabled={addTag.isPending} />
          <Button onClick={handleAdd} disabled={addTag.isPending || !value.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      )}

      {isPending ? (
        <Skeleton className="h-8 w-64" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No tags yet"
          description="Tags help you find related matters quickly across the Docket."
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1">
              {tag.tag_name}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => removeTag.mutate(tag.id)}
                  disabled={removeTag.isPending}
                  className="rounded-full p-0.5 hover:bg-background/60"
                  aria-label={`Remove tag ${tag.tag_name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
