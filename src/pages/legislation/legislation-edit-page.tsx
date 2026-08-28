import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Eye, Trash2 } from "lucide-react";
import { Billboard } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { Field, JurisdictionField } from "@/components/legal-library/taxonomy-fields";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { useAuth } from "@/hooks/use-auth";
import { useLegalJurisdictions } from "@/hooks/legal-library/use-legal-taxonomy";
import {
  useStatute,
  useUpdateCanonicalStatute,
  useDeleteCanonicalStatute,
} from "@/hooks/legislation/use-legislation";
import { LegislationPdfUploadPanel } from "@/pages/admin/legislation-pdf-upload-panel";
import { LegislationPdfViewerDialog } from "@/components/legislation/legislation-pdf-viewer-dialog";
import { ROUTES } from "@/routes/paths";

/**
 * Legislation edit page — the ONLY place metadata can be edited or the
 * PDF replaced. Reached exclusively via the explicit "Edit" action on
 * LegislationViewerPage; never entered automatically. Route-gated
 * `allowedRoles={["admin"]}` (router.tsx) — a non-admin direct-navigating
 * here hits /unauthorized before this component ever mounts. The
 * `!isAdmin` check below is a second, defense-in-depth layer (mirroring
 * this app's established pattern elsewhere) — the real boundary is RLS:
 * `statutes` UPDATE/DELETE and the `documents`/`finalize_legislation_-
 * document` write paths are unconditionally admin-only regardless of
 * what this page does or doesn't render.
 */
export default function LegislationEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const { data: statute, isPending, isError, error, refetch } = useStatute(id);
  const { data: jurisdictions } = useLegalJurisdictions();
  const updateStatute = useUpdateCanonicalStatute(id ?? "");
  const deleteStatute = useDeleteCanonicalStatute();

  const [initialized, setInitialized] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fields, setFields] = useState({
    code: "",
    title: "",
    short_title: "",
    jurisdiction_id: "" as string,
    instrument_type: "",
    act_number: "",
    chapter_number: "",
    enactment_year: "",
    effective_date: "",
    summary: "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);

  // Populate the form ONCE when the record first loads -- never again on
  // a background refetch, so an admin's in-progress edits are never
  // silently clobbered by a refresh triggered elsewhere.
  useEffect(() => {
    if (statute && !initialized) {
      setFields({
        code: statute.code,
        title: statute.title,
        short_title: statute.short_title ?? "",
        jurisdiction_id: statute.jurisdiction_id ?? "",
        instrument_type: statute.instrument_type ?? "",
        act_number: statute.act_number ?? "",
        chapter_number: statute.chapter_number ?? "",
        enactment_year: statute.enactment_year != null ? String(statute.enactment_year) : "",
        effective_date: statute.effective_date ?? "",
        summary: statute.summary ?? "",
      });
      setInitialized(true);
    }
  }, [statute, initialized]);

  // Same pattern as judgment-detail-page.tsx's ContentCard: warn on tab
  // close/refresh while there are unsaved metadata edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function setField<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  if (isPending) {
    return (
      <div className="browse-gutter space-y-4 pt-24">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (!statute) {
    return <InlineError error={new Error("This item doesn't exist, or you don't have access to it.")} />;
  }
  if (!isAdmin) {
    return (
      <InlineError
        error={new Error("You are not authorized to edit Legislation. Contact an administrator.")}
      />
    );
  }

  const jurisdictionName = (jurisdictions ?? []).find((j) => j.id === fields.jurisdiction_id)?.name ?? "";
  const canSave = fields.code.trim() && fields.title.trim() && fields.jurisdiction_id;

  function handleCancel() {
    navigate(ROUTES.legislationDetail(statute!.id));
  }

  function handleSave() {
    updateStatute.mutate(
      {
        code: fields.code.trim(),
        title: fields.title.trim(),
        short_title: fields.short_title.trim() || null,
        jurisdiction: jurisdictionName,
        jurisdiction_id: fields.jurisdiction_id || null,
        instrument_type: fields.instrument_type.trim() || null,
        act_number: fields.act_number.trim() || null,
        chapter_number: fields.chapter_number.trim() || null,
        enactment_year: fields.enactment_year.trim() ? Number(fields.enactment_year) : null,
        effective_date: fields.effective_date || null,
        summary: fields.summary.trim() || null,
      },
      {
        onSuccess: () => {
          setDirty(false);
          navigate(ROUTES.legislationDetail(statute!.id));
        },
      },
    );
  }

  return (
    <>
      <Billboard
        variant="detail"
        eyebrow="Edit Legislation"
        title={statute.title}
        description="Metadata and file management -- changes here affect the shared Legislation library for every magistrate."
        badges={["Edit mode", "Admin only"]}
        tone="legislation"
        primaryAction={{ label: "Cancel", onClick: handleCancel }}
      />
      <div className="browse-gutter relative z-10 -mt-6 space-y-6 pb-20">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metadata</CardTitle>
            <CardDescription>Title, identifying numbers, jurisdiction, and dates shown in the Legislation library and detail page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" required hint="Short identifier, unique per jurisdiction.">
                <Input value={fields.code} onChange={(e) => setField("code", e.target.value)} />
              </Field>
              <Field label="Title" required>
                <Input value={fields.title} onChange={(e) => setField("title", e.target.value)} />
              </Field>
              <Field label="Short title">
                <Input value={fields.short_title} onChange={(e) => setField("short_title", e.target.value)} />
              </Field>
              <JurisdictionField
                value={fields.jurisdiction_id || null}
                onChange={(jid) => setField("jurisdiction_id", jid ?? "")}
                jurisdictions={jurisdictions ?? []}
              />
              <Field label="Document type" hint="e.g. Act, Regulations, Rules, Order">
                <Input value={fields.instrument_type} onChange={(e) => setField("instrument_type", e.target.value)} />
              </Field>
              <Field label="Act number">
                <Input value={fields.act_number} onChange={(e) => setField("act_number", e.target.value)} />
              </Field>
              <Field label="Chapter number">
                <Input value={fields.chapter_number} onChange={(e) => setField("chapter_number", e.target.value)} />
              </Field>
              <Field label="Enactment year">
                <Input type="number" value={fields.enactment_year} onChange={(e) => setField("enactment_year", e.target.value)} />
              </Field>
              <Field label="Effective date">
                <DateOnlyInput value={fields.effective_date} onChange={(v) => setField("effective_date", v)} />
              </Field>
            </div>
            <Field label="Description or administrative note (optional)">
              <Textarea value={fields.summary} onChange={(e) => setField("summary", e.target.value)} rows={3} />
            </Field>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={handleCancel} disabled={updateStatute.isPending}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!canSave || updateStatute.isPending}>
                {updateStatute.isPending && <LoadingSpinner className="text-current" size={16} />}
                Save changes
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current PDF</CardTitle>
            <CardDescription>
              {statute.primary_document_id
                ? "The document every magistrate currently sees when viewing this Act."
                : "No PDF is currently linked to this record."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {statute.primary_document_id && (
              <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                <Eye className="h-4 w-4" />
                Preview current PDF
              </Button>
            )}
            <Button variant="outline" onClick={() => setReplaceOpen((v) => !v)}>
              {statute.primary_document_id ? "Replace PDF" : "Upload PDF"}
            </Button>
          </CardContent>
          {replaceOpen && (
            <CardContent className="border-t border-border pt-4">
              <p className="mb-3 text-xs text-muted-foreground">
                Uploading here publishes a new version. The current version is preserved and remains reachable — never deleted or overwritten.
              </p>
              <LegislationPdfUploadPanel
                supersede={{
                  id: statute.id,
                  code: statute.code,
                  title: statute.title,
                  short_title: statute.short_title,
                  jurisdiction_id: statute.jurisdiction_id,
                  instrument_type: statute.instrument_type,
                  act_number: statute.act_number,
                  chapter_number: statute.chapter_number,
                  enactment_year: statute.enactment_year,
                  effective_date: statute.effective_date,
                  summary: statute.summary,
                }}
                onSuccess={(newStatuteId) => navigate(ROUTES.legislationDetail(newStatuteId))}
              />
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">Delete this record</CardTitle>
            <CardDescription>Permanently removes it from the shared library for every magistrate, including its provisions and any attached documents. This cannot be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Delete Legislation record
            </Button>
          </CardContent>
        </Card>
      </div>

      {statute.primary_document_id && (
        <LegislationPdfViewerDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          documentId={statute.primary_document_id}
          title={statute.title}
        />
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this Legislation record?"
        description="This permanently removes it from the shared library for every magistrate — including its provisions and any attached documents. This cannot be undone."
        confirmLabel="Delete"
        isConfirming={deleteStatute.isPending}
        onConfirm={() =>
          deleteStatute.mutate(statute.id, {
            onSuccess: () => navigate(ROUTES.legislation),
          })
        }
      />
    </>
  );
}
