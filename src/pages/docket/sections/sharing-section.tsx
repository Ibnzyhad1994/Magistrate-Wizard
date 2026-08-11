import { useState } from "react";
import { Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  type ResolvedShare,
  useDocketShares,
  useRevokeShare,
  useUpdateSharePermission,
} from "@/hooks/docket/use-docket-shares";
import { formatDate } from "@/lib/utils";

interface SharingSectionProps {
  matterId: string;
}

export function SharingSection({ matterId }: SharingSectionProps) {
  const { data, isPending, isError, error, refetch } = useDocketShares(matterId);
  const updatePermission = useUpdateSharePermission(matterId);
  const revokeShare = useRevokeShare(matterId);
  const [pendingRevoke, setPendingRevoke] = useState<ResolvedShare | null>(null);

  const activeShares = data?.filter((s) => !s.revoked_at) ?? [];

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Sharing grants another magistrate or clerk access to this matter.
        Recipients cannot re-share it further.
      </p>

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : activeShares.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="Not shared with anyone"
          description="Active shares granted on this matter will appear here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Granted by</TableHead>
              <TableHead>Permission</TableHead>
              <TableHead>Since</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeShares.map((share) => (
              <TableRow key={share.id}>
                <TableCell className="font-medium text-foreground">
                  {share.recipient_display_name ?? "Unknown"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {share.grantor_display_name ?? "Unknown"}
                </TableCell>
                <TableCell>
                  <Select
                    className="h-8 w-24"
                    value={share.permission}
                    disabled={updatePermission.isPending}
                    onChange={(e) =>
                      updatePermission.mutate({
                        id: share.id,
                        permission: e.target.value as "view" | "edit",
                      })
                    }
                  >
                    <option value="view">view</option>
                    <option value="edit">edit</option>
                  </Select>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(share.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setPendingRevoke(share)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        <Badge variant="outline" className="mb-2">
          Known limitation
        </Badge>
        <p>
          Granting a new share requires looking up a recipient by email, and
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">profiles</code>
          is only readable by its owner or an admin under current RLS. That
          lookup mechanism doesn&apos;t exist yet and is a genuine backend
          decision (e.g. a scoped directory RPC), not something to invent
          here — so &quot;new share&quot; isn&apos;t exposed in this build.
        </p>
      </div>

      <AlertDialog
        open={!!pendingRevoke}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        title="Revoke this share?"
        description={
          pendingRevoke
            ? `${pendingRevoke.recipient_display_name ?? "This recipient"} will immediately lose access to this matter.`
            : undefined
        }
        confirmLabel="Revoke"
        isConfirming={revokeShare.isPending}
        onConfirm={() => {
          if (pendingRevoke) {
            revokeShare.mutate(pendingRevoke.id, {
              onSuccess: () => setPendingRevoke(null),
            });
          }
        }}
      />
    </div>
  );
}
