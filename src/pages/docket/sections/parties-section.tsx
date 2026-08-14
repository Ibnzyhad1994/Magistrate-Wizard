import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  useCreateDocketParty,
  useDocketParties,
  useUpdateDocketParty,
} from "@/hooks/docket/use-docket-parties";
import {
  PARTY_ROLES,
  PARTY_STATUSES,
  PARTY_TYPES,
  docketPartySchema,
  type DocketPartyFormValues,
} from "@/lib/validations/docket";
import { toTitleCase } from "@/lib/utils";
import type { DocketMatterParty } from "@/types/database.types";
import { SignedThumb } from "@/components/common/signed-thumb";
import { IdentificationImageControl } from "@/components/common/identification-image-control";
import {
  useClearPartyPhoto,
  useSetPartyPhoto,
} from "@/hooks/docket/use-identification-images";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";

interface PartiesSectionProps {
  matterId: string;
}

export function PartiesSection({ matterId }: PartiesSectionProps) {
  const { data, isPending, isError, error, refetch } = useDocketParties(matterId);
  const { data: access } = useDocketMatterAccess(matterId);
  const canEdit = access?.canEdit ?? false;
  const [dialogParty, setDialogParty] = useState<DocketMatterParty | "new" | null>(
    null,
  );

  const activeParties = data?.filter((p) => p.party_status === "active") ?? [];
  const correctedParties = data?.filter((p) => p.party_status !== "active") ?? [];

  return (
    <div className="mt-4 space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialogParty("new")}>
            <Plus className="h-4 w-4" />
            Add party
          </Button>
        </div>
      )}

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No parties recorded"
          description="Accused, complainants, and other parties to this matter will appear here."
          action={
            canEdit ? (
              <Button size="sm" onClick={() => setDialogParty("new")}>
                <Plus className="h-4 w-4" />
                Add the first party
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Photo</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Attorney</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...activeParties, ...correctedParties].map((party) => (
              <TableRow
                key={party.id}
                className={canEdit ? "cursor-pointer" : undefined}
                onClick={canEdit ? () => setDialogParty(party) : undefined}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <SignedThumb
                    path={party.identification_photo_path}
                    alt={party.full_name}
                    className="h-10 w-10 rounded-sm"
                  />
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {party.full_name}
                </TableCell>
                <TableCell>{toTitleCase(party.role)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {toTitleCase(party.party_type)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {party.attorney_name || "—"}
                </TableCell>
                <TableCell>
                  {party.party_status !== "active" && (
                    <Badge variant="destructive">{toTitleCase(party.party_status)}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialogParty && (
        <PartyDialog
          matterId={matterId}
          party={dialogParty === "new" ? null : dialogParty}
          onClose={() => setDialogParty(null)}
        />
      )}
    </div>
  );
}

function PartyDialog({
  matterId,
  party,
  onClose,
}: {
  matterId: string;
  party: DocketMatterParty | null;
  onClose: () => void;
}) {
  const createParty = useCreateDocketParty(matterId);
  const updateParty = useUpdateDocketParty(matterId);
  const setPhoto = useSetPartyPhoto(matterId);
  const clearPhoto = useClearPartyPhoto(matterId);
  const isPending = createParty.isPending || updateParty.isPending;

  const form = useForm<DocketPartyFormValues>({
    resolver: zodResolver(docketPartySchema),
    defaultValues: {
      full_name: party?.full_name ?? "",
      party_type: (party?.party_type as DocketPartyFormValues["party_type"]) ?? "individual",
      role: party?.role as DocketPartyFormValues["role"],
      attorney_name: party?.attorney_name ?? "",
      contact_info: party?.contact_info ?? "",
      party_status: (party?.party_status as DocketPartyFormValues["party_status"]) ?? "active",
    },
  });

  async function onSubmit(values: DocketPartyFormValues) {
    const payload = {
      full_name: values.full_name,
      party_type: values.party_type,
      role: values.role,
      attorney_name: values.attorney_name || null,
      contact_info: values.contact_info || null,
      party_status: values.party_status,
    };
    try {
      if (party) {
        await updateParty.mutateAsync({ id: party.id, values: payload });
      } else {
        await createParty.mutateAsync(payload);
      }
      onClose();
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{party ? "Edit party" : "Add party"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <FormControl>
                      <Select {...field} value={field.value ?? ""}>
                        <option value="" disabled>
                          Select a role…
                        </option>
                        {PARTY_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {toTitleCase(r)}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="party_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <Select {...field}>
                        {PARTY_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {toTitleCase(t)}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="attorney_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Attorney (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contact_info"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact info (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {party && (
              <IdentificationImageControl
                path={party.identification_photo_path}
                alt={party.full_name}
                label="Identification photo"
                description="Used to recognize this party in court. If the matter has no cover yet, this photo becomes the Docket cover."
                isPending={setPhoto.isPending || clearPhoto.isPending}
                onUpload={(file) => setPhoto.mutate({ partyId: party.id, file })}
                onClear={() => clearPhoto.mutate(party.id)}
              />
            )}

            {party && (
              <FormField
                control={form.control}
                name="party_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <Select {...field}>
                        {PARTY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {toTitleCase(s)}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <LoadingSpinner className="text-current" size={16} />}
                {party ? "Save changes" : "Add party"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
