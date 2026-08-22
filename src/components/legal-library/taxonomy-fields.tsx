import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  useLegalJurisdictions,
  useLegalRegionalGroups,
  useCreateLegalJurisdiction,
  useCreateLegalAuthorityCourt,
  useCreateLegalCaseCategory,
} from "@/hooks/legal-library/use-legal-taxonomy";
import { getErrorMessage } from "@/lib/utils";
import type { LegalJurisdiction, LegalAuthorityCourt, LegalCaseCategory } from "@/types/database.types";

/**
 * Shared Jurisdiction/Court/Category `<Field>`+`<Select>` controls with an
 * inline "+ Add new…" escape hatch — originally built inline in the admin
 * Legal Library page (New Import / Review Queue), extracted here so the
 * Case Law and Legislation detail pages' own admin-edit forms can reuse
 * the exact same catalogue-backed controls rather than a parallel
 * free-text override (which would let the same Court/Jurisdiction/Category
 * get entered under several different spellings across records).
 */

/** Small labeled-field wrapper — every field using these controls renders through this so no field is ever identifiable only by placeholder text. */
export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Sentinel option value for the "+ Add new…" entry in the Court/
 * Jurisdiction/Category selects below — never a real row id, so it can't
 * collide with an actual uuid. */
const ADD_NEW_SENTINEL = "__add_new__";

function AddJurisdictionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (jurisdiction: LegalJurisdiction) => void;
}) {
  const { data: regionalGroups } = useLegalRegionalGroups();
  const create = useCreateLegalJurisdiction();
  const [name, setName] = useState("");
  const [regionalGroupId, setRegionalGroupId] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setRegionalGroupId("");
    }
  }, [open]);

  function handleCreate() {
    if (!name.trim() || !regionalGroupId) return;
    create.mutate(
      { name: name.trim(), regional_group_id: regionalGroupId },
      {
        onSuccess: (row) => {
          toast.success(`"${row.name}" added to the Jurisdiction catalogue.`);
          onCreated(row);
          onOpenChange(false);
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a new Jurisdiction</DialogTitle>
          <DialogDescription>
            Added to the shared canonical catalogue — every future Case Law/Legislation record can select it, not
            just this one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Saint Lucia"
              autoFocus
            />
          </Field>
          <Field label="Regional group" required hint="Where this jurisdiction belongs in the Browse taxonomy.">
            <Select value={regionalGroupId} onChange={(e) => setRegionalGroupId(e.target.value)}>
              <option value="">Select a regional group</option>
              {(regionalGroups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!name.trim() || !regionalGroupId || create.isPending}>
            Add Jurisdiction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCourtDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (court: LegalAuthorityCourt) => void;
}) {
  const { data: jurisdictions } = useLegalJurisdictions();
  const create = useCreateLegalAuthorityCourt();
  const [canonicalName, setCanonicalName] = useState("");
  const [shortName, setShortName] = useState("");
  const [jurisdictionId, setJurisdictionId] = useState("");
  const [courtLevel, setCourtLevel] = useState("");

  useEffect(() => {
    if (open) {
      setCanonicalName("");
      setShortName("");
      setJurisdictionId("");
      setCourtLevel("");
    }
  }, [open]);

  function handleCreate() {
    if (!canonicalName.trim()) return;
    create.mutate(
      {
        canonical_name: canonicalName.trim(),
        short_name: shortName || null,
        jurisdiction_id: jurisdictionId || null,
        court_level: courtLevel || null,
      },
      {
        onSuccess: (row) => {
          toast.success(`"${row.canonical_name}" added to the Court catalogue.`);
          onCreated(row);
          onOpenChange(false);
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a new Court</DialogTitle>
          <DialogDescription>
            Added to the shared canonical catalogue — every future Case Law record can select it, not just this
            one. Leave Jurisdiction unset for a regional/supranational court (e.g. CCJ, Privy Council).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Canonical name" required>
            <Input
              value={canonicalName}
              onChange={(e) => setCanonicalName(e.target.value)}
              placeholder="e.g. Court of Appeal of Saint Lucia"
              autoFocus
            />
          </Field>
          <Field label="Short name">
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Jurisdiction" hint="Leave unset for a regional/supranational court.">
            <Select value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)}>
              <option value="">None (regional/supranational)</option>
              {(jurisdictions ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Court level">
            <Select value={courtLevel} onChange={(e) => setCourtLevel(e.target.value)}>
              <option value="">Unspecified</option>
              <option value="apex">Apex</option>
              <option value="appellate">Appellate</option>
              <option value="superior">Superior</option>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canonicalName.trim() || create.isPending}>
            Add Court
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCategoryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: LegalCaseCategory) => void;
}) {
  const create = useCreateLegalCaseCategory();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  function handleCreate() {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim() },
      {
        onSuccess: (row) => {
          toast.success(`"${row.name}" added to the Category catalogue.`);
          onCreated(row);
          onOpenChange(false);
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a new Category</DialogTitle>
          <DialogDescription>
            Added to the shared canonical catalogue — every future Case Law record can select it, not just this
            one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Narcotics"
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!name.trim() || create.isPending}>
            Add Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Jurisdiction <Field>+<Select> with an inline "+ Add new Jurisdiction…" escape hatch — used everywhere Jurisdiction is selected (New Import, Review Queue, canonical-record editing). Never a free-text override; a new entry becomes a real canonical row so it never gets catalogued twice under different spellings. */
export function JurisdictionField({
  value,
  onChange,
  jurisdictions,
  required = true,
  hint,
}: {
  value: string | null;
  onChange: (jurisdictionId: string | null) => void;
  jurisdictions: LegalJurisdiction[];
  required?: boolean;
  hint?: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  return (
    <Field label="Jurisdiction" required={required} hint={hint}>
      <Select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === ADD_NEW_SENTINEL) {
            setShowAdd(true);
            return;
          }
          onChange(e.target.value || null);
        }}
      >
        <option value="">Select Jurisdiction — needs review</option>
        {jurisdictions.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
        <option value={ADD_NEW_SENTINEL}>+ Add new Jurisdiction…</option>
      </Select>
      <AddJurisdictionDialog open={showAdd} onOpenChange={setShowAdd} onCreated={(j) => onChange(j.id)} />
    </Field>
  );
}

/** Court <Field>+<Select> with the same inline "+ Add new Court…" escape hatch. `onChange` receives the full created/selected court (or null) rather than just an id, so a caller can auto-populate Jurisdiction from it exactly as it already does for an existing catalogue court. */
export function CourtField({
  value,
  onChange,
  courts,
  required = true,
  hint = "Selecting a Court automatically sets Jurisdiction where known.",
}: {
  value: string | null;
  onChange: (court: LegalAuthorityCourt | null) => void;
  courts: LegalAuthorityCourt[];
  required?: boolean;
  hint?: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  return (
    <Field label="Court" required={required} hint={hint}>
      <Select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === ADD_NEW_SENTINEL) {
            setShowAdd(true);
            return;
          }
          const next = courts.find((c) => c.id === e.target.value) ?? null;
          onChange(next);
        }}
      >
        <option value="">Select deciding Court — needs review</option>
        {courts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.canonical_name}
          </option>
        ))}
        <option value={ADD_NEW_SENTINEL}>+ Add new Court…</option>
      </Select>
      <AddCourtDialog open={showAdd} onOpenChange={setShowAdd} onCreated={(c) => onChange(c)} />
    </Field>
  );
}

/** Category <Field>+<Select> with an inline "+ Add new Category…" escape hatch, same pattern as Jurisdiction/Court above. The type of matter a Case Law record relates to (e.g. "Murder", "Narcotics") — used for Browse/filter navigation, distinct from the free-text `tags` classification. */
export function CategoryField({
  value,
  onChange,
  categories,
  required = false,
  hint,
}: {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  categories: LegalCaseCategory[];
  required?: boolean;
  hint?: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  return (
    <Field label="Category" required={required} hint={hint}>
      <Select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === ADD_NEW_SENTINEL) {
            setShowAdd(true);
            return;
          }
          onChange(e.target.value || null);
        }}
      >
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={ADD_NEW_SENTINEL}>+ Add new Category…</option>
      </Select>
      <AddCategoryDialog open={showAdd} onOpenChange={setShowAdd} onCreated={(c) => onChange(c.id)} />
    </Field>
  );
}
