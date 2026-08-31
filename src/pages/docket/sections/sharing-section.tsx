import { useState } from "react";
import { Share2, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  type ResolvedRecipient,
  type ResolvedShare,
  useCreateShare,
  useDocketShares,
  useResolveShareRecipient,
  useRevokeShare,
} from "@/hooks/docket/use-docket-shares";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, toTitleCase } from "@/lib/utils";

interface SharingSectionProps {
  matterId: string;
}

export function SharingSection({ matterId }: SharingSectionProps) {
  const { user } = useAuth();
  const { data: access } = useDocketMatterAccess(matterId);
  const canManage = access?.canManage ?? false;
  const { data, isPending, isError, error, refetch } = useDocketShares(matterId);
  const revokeShare = useRevokeShare(matterId);
  const [pendingRevoke, setPendingRevoke] = useState<ResolvedShare | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const activeShares = data?.filter((s) => !s.revoked_at) ?? [];
  const revokedShares = data?.filter((s) => s.revoked_at) ?? [];

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-lg text-sm text-muted-foreground">
          Sharing grants another magistrate or clerk access to this matter.
          Recipients cannot re-share it further. Permission is fixed when the
          share is created. To change view into edit (or the reverse), revoke
          it and share again.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New share
          </Button>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : activeShares.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="Not shared with anyone"
          description="Active shares granted on this matter will appear here."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Share this matter
              </Button>
            ) : undefined
          }
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
                  {toTitleCase(share.permission)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(share.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  {(canManage || share.recipient_id === user?.id) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingRevoke(share)}
                    >
                      {share.recipient_id === user?.id && !canManage
                        ? "Give back access"
                        : "Revoke"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {revokedShares.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            History
          </p>
          <Table>
            <TableBody>
              {revokedShares.map((share) => (
                <TableRow key={share.id}>
                  <TableCell className="text-muted-foreground">
                    {share.recipient_display_name ?? "Unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {toTitleCase(share.permission)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    Revoked {formatDate(share.revoked_at as string)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateShareDialog
        matterId={matterId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

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

function CreateShareDialog({
  matterId,
  open,
  onClose,
}: {
  matterId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [notFound, setNotFound] = useState(false);

  const resolveRecipient = useResolveShareRecipient(matterId);
  const createShare = useCreateShare(matterId);

  function reset() {
    setEmail("");
    setPermission("view");
    setResolved(null);
    setNotFound(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleResolve() {
    setNotFound(false);
    setResolved(null);
    const result = await resolveRecipient.mutateAsync(email);
    if (result) {
      setResolved(result);
    } else {
      setNotFound(true);
    }
  }

  async function handleCreate() {
    if (!resolved) return;
    try {
      await createShare.mutateAsync({
        recipientId: resolved.profile_id,
        permission,
      });
      handleClose();
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this matter</DialogTitle>
          <DialogDescription>
            Enter the exact email address of the magistrate or clerk you want
            to share with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="colleague@court.gov"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setResolved(null);
                setNotFound(false);
              }}
              aria-label="Recipient email"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleResolve()}
              disabled={!email.trim() || resolveRecipient.isPending}
            >
              {resolveRecipient.isPending && <LoadingSpinner size={14} />}
              Find
            </Button>
          </div>

          {resolved && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="font-medium text-foreground">
                {resolved.display_name ?? "Recipient found"}
              </span>
            </div>
          )}

          {notFound && (
            <p className="text-sm text-destructive">
              No eligible recipient found for that email. Double-check the
              address: they must be an active user, and you must currently
              have Court or retained authority on this matter to share it.
            </p>
          )}

          {resolved && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Permission
              </label>
              <Select
                value={permission}
                onChange={(e) => setPermission(e.target.value as "view" | "edit")}
                aria-label="Share permission"
              >
                <option value="view">View (can see the matter, not edit it)</option>
                <option value="edit">Edit (can also make changes)</option>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!resolved || createShare.isPending}
          >
            {createShare.isPending && <LoadingSpinner className="text-current" size={16} />}
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
