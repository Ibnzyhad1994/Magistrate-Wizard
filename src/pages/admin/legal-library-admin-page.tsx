import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Landmark,
  Plus,
  ScrollText,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  useLegalSources,
  useCreateLegalSource,
  useDeleteLegalSource,
} from "@/hooks/legal-library/use-legal-sources";
import {
  useLegalJurisdictions,
  useLegalAuthorityCourts,
} from "@/hooks/legal-library/use-legal-taxonomy";
import {
  useIngestCaseLaw,
  useIngestLegislation,
} from "@/hooks/legal-library/use-import-jobs";
import {
  useCaseLawReviewQueue,
  useUpdateCanonicalCaseLaw,
  useSetCaseLawReviewStatus,
  useRejectCanonicalCaseLaw,
} from "@/hooks/case-law/use-case-law";
import { useCaseLawTags, useApplyCaseLawTags } from "@/hooks/case-law/use-case-law-tags";
import {
  useLegislationReviewQueue,
  useUpdateCanonicalStatute,
  useSetStatuteReviewStatus,
  useRejectCanonicalStatute,
  useStatuteProvisions,
} from "@/hooks/legislation/use-legislation";
import { useStatuteTags, useApplyStatuteTags } from "@/hooks/legislation/use-statute-tags";
import { getDocumentViewUrl } from "@/hooks/use-documents";
import { readFileAsText } from "@/lib/legal-extraction";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { CaseLaw, Statute } from "@/types/database.types";

type ReviewRow<T> = T & {
  duplicate_warning: string | null;
  proposed_tags: string[];
  uploaded_document_id: string | null;
  job_status: string | null;
};

/**
 * Compact chip-based tag reviewer shared by both Review Queue cards (§15/
 * §16): proposed tags from deterministic extraction (import_jobs.
 * proposed_tags) plus any already-applied canonical tags are shown as
 * toggleable chips; the reviewer can also add a free-text tag. Nothing is
 * written until "Save tags" is pressed — extraction proposes, it never
 * silently classifies.
 */
function TagReviewEditor({
  proposed,
  applied,
  onSave,
  isSaving,
}: {
  proposed: string[];
  applied: string[];
  onSave: (names: string[]) => void;
  isSaving: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(applied));
  const [customTag, setCustomTag] = useState("");
  const [allNames, setAllNames] = useState<string[]>(() =>
    Array.from(new Set([...applied, ...proposed])),
  );
  // `applied` loads asynchronously (a separate query from the review-queue
  // row itself) — resync once it arrives rather than freezing on the
  // empty-array value captured at first mount, so previously-saved tags
  // for a draft the reviewer returns to show as already checked.
  const [syncedApplied, setSyncedApplied] = useState(applied);
  useEffect(() => {
    if (applied.length !== syncedApplied.length || applied.some((t) => !syncedApplied.includes(t))) {
      setSelected(new Set(applied));
      setAllNames((prev) => Array.from(new Set([...prev, ...applied, ...proposed])));
      setSyncedApplied(applied);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);
  const dirty =
    selected.size !== applied.length || [...selected].some((t) => !applied.includes(t));

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customTag.trim();
    if (!name) return;
    if (!allNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setAllNames((prev) => [...prev, name]);
    }
    setSelected((prev) => new Set(prev).add(name));
    setCustomTag("");
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Tags {proposed.length > 0 && "— proposed from document text, review before saving"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {allNames.length === 0 && (
          <span className="text-xs text-muted-foreground">No tags proposed.</span>
        )}
        {allNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              selected.has(name)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {selected.has(name) ? "✓ " : "+ "}
            {name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add a tag…"
          className="h-8 text-xs"
        />
        <Button size="sm" variant="outline" className="h-8" onClick={addCustom}>
          Add
        </Button>
        {dirty && (
          <Button size="sm" className="h-8" disabled={isSaving} onClick={() => onSave([...selected])}>
            Save tags
          </Button>
        )}
      </div>
    </div>
  );
}

function OriginalDocumentLink({ documentId }: { documentId: string | null }) {
  const [loading, setLoading] = useState(false);
  if (!documentId) {
    return (
      <p className="text-xs text-muted-foreground">
        No original file attached — attach one from New Import, or paste text only.
      </p>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const { data, error } = await supabase
            .from("documents")
            .select("file_path")
            .eq("id", documentId)
            .single();
          if (error || !data) throw error ?? new Error("Document not found.");
          const url = await getDocumentViewUrl(data.file_path);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not open the original file.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <Download className="h-3.5 w-3.5" />
      Original file
    </Button>
  );
}

/**
 * Admin/curator Legal Library workspace — Sources / New Import / Review
 * Queue, per the ingestion architecture (0055 migration + legal-extraction.ts
 * + use-legal-sources.ts/use-import-jobs.ts). Deliberately not in the
 * ordinary magistrate sidebar (route is admin-role-gated, see router.tsx
 * and nav-config.ts).
 *
 * Honesty notes surfaced directly in this UI (never silently glossed over):
 * - No PDF/DOCX text extraction library is available in this build. A
 *   .txt upload is read automatically; PDF/DOCX require the curator to
 *   paste text (e.g. copied from the in-app PDF viewer).
 * - URL/source-adapter fetching is NOT implemented (no verified safe
 *   server-side fetch infrastructure in this environment) — Sources here
 *   are a reviewable REGISTRY only; adding one does not trigger a crawl.
 * - Tag proposals are keyword/rule-based, not AI. No AI classification is
 *   configured in this build.
 */
export default function LegalLibraryAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Legal Library
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage source registrations, ingest Case Law and Legislation, and
          review drafts before they become canonical.
        </p>
      </div>

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="import">New Import</TabsTrigger>
          <TabsTrigger value="review">Review Queue</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <SourcesTab />
        </TabsContent>
        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
        <TabsContent value="review">
          <ReviewQueueTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCE_STATUS_VARIANT: Record<string, "outline" | "default" | "secondary" | "destructive"> = {
  proposed: "outline",
  testing: "secondary",
  approved: "default",
  disabled: "outline",
  failed: "destructive",
};

function SourcesTab() {
  const { data: sources, isPending } = useLegalSources();
  const createSource = useCreateLegalSource();
  const deleteSource = useDeleteLegalSource();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    jurisdiction: "",
    base_url: "",
    source_type: "case_law",
    connector_type: "manual",
    canonical_trusted: false,
    notes: "",
  });

  function reset() {
    setForm({
      name: "",
      jurisdiction: "",
      base_url: "",
      source_type: "case_law",
      connector_type: "manual",
      canonical_trusted: false,
      notes: "",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Source registry</CardTitle>
            <CardDescription>
              A record that a source is intended to be used — not an active
              crawler. Adding a source here does not fetch anything; there is
              no automated connector wired up in this build (source/URL
              ingestion here is manual paste-and-submit only, see New
              Import).
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen((o) => !o)}>
            <Plus className="h-4 w-4" />
            Add source
          </Button>
        </CardHeader>
        {open && (
          <CardContent className="space-y-3 border-t border-border pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Name (e.g. Guyana Ministry of Legal Affairs)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                placeholder="Jurisdiction (e.g. Guyana)"
                value={form.jurisdiction}
                onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
              />
              <Input
                placeholder="Base URL"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              />
              <Select
                value={form.source_type}
                onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}
              >
                <option value="case_law">Case Law source</option>
                <option value="legislation">Legislation source</option>
                <option value="mixed">Mixed (both)</option>
              </Select>
              <Select
                value={form.connector_type}
                onChange={(e) => setForm((f) => ({ ...f, connector_type: e.target.value }))}
              >
                <option value="manual">Manual (no automated connector)</option>
                <option value="direct_document">Direct document</option>
                <option value="html_document">HTML document</option>
                <option value="index_page">Index page</option>
                <option value="structured_feed">Structured feed</option>
                <option value="custom_adapter">Custom adapter</option>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.canonical_trusted}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, canonical_trusted: c }))}
                />
                Canonical / trusted source
              </label>
            </div>
            <Textarea
              placeholder="Notes — access terms, reliability, format quirks…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); reset(); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!form.name.trim() || !form.jurisdiction.trim() || createSource.isPending}
                onClick={() =>
                  createSource.mutate(
                    {
                      name: form.name.trim(),
                      jurisdiction: form.jurisdiction.trim(),
                      base_url: form.base_url.trim() || null,
                      source_type: form.source_type,
                      connector_type: form.connector_type,
                      canonical_trusted: form.canonical_trusted,
                      notes: form.notes.trim() || null,
                      status: "proposed",
                    },
                    { onSuccess: () => { setOpen(false); reset(); } },
                  )
                }
              >
                Save source
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !sources || sources.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Landmark}
              className="border-0"
              title="No sources registered"
              description="Register a legal source to track its status and reference it from imports."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{s.name}</p>
                    <Badge variant={SOURCE_STATUS_VARIANT[s.status] ?? "outline"}>
                      {s.status}
                    </Badge>
                    {s.canonical_trusted && <Badge variant="canonical">Trusted</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.jurisdiction, s.source_type, s.connector_type].filter(Boolean).join(" · ")}
                    {s.base_url ? ` · ${s.base_url}` : ""}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove source"
                  onClick={() => setDeleteTarget(s.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Remove this source?"
        description="This removes the source registry entry. Any Case Law/Legislation already imported referencing it keeps its own recorded provenance (source name/URL are stored on the record itself, not only via this reference)."
        confirmLabel="Remove"
        confirmVariant="destructive"
        isConfirming={deleteSource.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteSource.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Import
// ---------------------------------------------------------------------------

function ImportTab() {
  const [contentType, setContentType] = useState<"case_law" | "legislation">("case_law");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [courtId, setCourtId] = useState<string>("");
  const [jurisdictionId, setJurisdictionId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [caseFields, setCaseFields] = useState({ case_name: "", citation: "", court: "", jurisdiction: "" });
  const [statuteFields, setStatuteFields] = useState({ code: "", title: "", jurisdiction: "", short_title: "" });

  const ingestCaseLaw = useIngestCaseLaw();
  const ingestLegislation = useIngestLegislation();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const navigate = useNavigate();

  // Source selection is about PROVENANCE (which repository the document
  // came from) and is entirely separate from Jurisdiction/Court (which
  // court decided the case) — §7/§8. A source may be left unassigned; the
  // free-text Source URL field is preserved either way.
  const approvedSources = (sources ?? []).filter((s) => s.status === "approved");
  const otherSources = (sources ?? []).filter((s) => s.status !== "approved");

  async function handleFile(f: File) {
    // The original file is ALWAYS kept and uploaded through the secure
    // documents Storage architecture on submit (uploadDocumentToEntity,
    // private bucket, signed URLs only) — selecting a PDF/DOCX no longer
    // discards the file itself, only its automatic text extraction is
    // unavailable. TXT can be deterministically read client-side; that is
    // real text extraction for that one format, not a claim extended to
    // PDF/DOCX.
    setFile(f);
    if (f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt")) {
      const read = await readFileAsText(f);
      setText(read);
      toast.success("Original file will be uploaded and preserved. Text read automatically from the .txt file.");
    } else {
      toast.message(
        "Original file will be uploaded and preserved. Automatic text extraction is not yet available for PDF/DOC/DOCX — paste the extracted text below to continue (or leave blank and paste it later from the Review Queue).",
      );
    }
  }

  const canSubmitCaseLaw =
    caseFields.citation.trim() && caseFields.court.trim() && caseFields.jurisdiction.trim();
  const canSubmitStatute =
    statuteFields.code.trim() && statuteFields.title.trim() && statuteFields.jurisdiction.trim();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deterministic ingestion — no AI</CardTitle>
          <CardDescription>
            Hashing, citation/date/section-heading parsing, and canonical tag
            proposals run automatically over the text below. Nothing is
            published immediately — this creates a draft record sent to the
            Review Queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as "case_law" | "legislation")}
              className="max-w-xs"
            >
              <option value="case_law">Case Law</option>
              <option value="legislation">Legislation</option>
            </Select>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" />
              Upload file
              <input
                type="file"
                className="hidden"
                accept=".txt,.pdf,.doc,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </label>
            {file && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                {file.name} — will be uploaded and preserved
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="Source URL (optional — provenance only, not fetched)"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">Source repository — unassigned</option>
              {approvedSources.length > 0 && (
                <optgroup label="Approved">
                  {approvedSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherSources.length > 0 && (
                <optgroup label="Not yet approved">
                  {otherSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Source repository is where the document came from — it does not decide the
            Jurisdiction or Court below; two copies of the same case can come from different
            repositories.
          </p>

          {contentType === "case_law" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Case name (optional — proposed from text if left blank)"
                value={caseFields.case_name}
                onChange={(e) => setCaseFields((f) => ({ ...f, case_name: e.target.value }))}
              />
              <Input
                placeholder="Citation *"
                value={caseFields.citation}
                onChange={(e) => setCaseFields((f) => ({ ...f, citation: e.target.value }))}
              />
              <Input
                placeholder="Court * (free text, e.g. as printed on the judgment)"
                value={caseFields.court}
                onChange={(e) => setCaseFields((f) => ({ ...f, court: e.target.value }))}
              />
              <Input
                placeholder="Jurisdiction * (free text)"
                value={caseFields.jurisdiction}
                onChange={(e) => setCaseFields((f) => ({ ...f, jurisdiction: e.target.value }))}
              />
              <Select value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)}>
                <option value="">Canonical Jurisdiction — not set (needs review)</option>
                {(jurisdictions ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </Select>
              <Select value={courtId} onChange={(e) => setCourtId(e.target.value)}>
                <option value="">Canonical deciding Court — not set (needs review)</option>
                {(courts ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.canonical_name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Code * (short identifier, unique per jurisdiction)"
                value={statuteFields.code}
                onChange={(e) => setStatuteFields((f) => ({ ...f, code: e.target.value }))}
              />
              <Input
                placeholder="Title *"
                value={statuteFields.title}
                onChange={(e) => setStatuteFields((f) => ({ ...f, title: e.target.value }))}
              />
              <Input
                placeholder="Jurisdiction *"
                value={statuteFields.jurisdiction}
                onChange={(e) => setStatuteFields((f) => ({ ...f, jurisdiction: e.target.value }))}
              />
              <Input
                placeholder="Short title (optional)"
                value={statuteFields.short_title}
                onChange={(e) => setStatuteFields((f) => ({ ...f, short_title: e.target.value }))}
              />
              <Select value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)}>
                <option value="">Canonical Jurisdiction — not set (needs review)</option>
                {(jurisdictions ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <Textarea
            placeholder="Document text (optional if the original file is attached) — auto-read for .txt uploads, pasted for PDF/DOCX…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
          />
          {!text.trim() && !file && (
            <p className="text-xs text-muted-foreground">
              Provide either document text or an original file (or both) before creating the draft.
            </p>
          )}

          <div className="flex justify-end">
            {contentType === "case_law" ? (
              <Button
                disabled={
                  !canSubmitCaseLaw || (!text.trim() && !file) || ingestCaseLaw.isPending
                }
                onClick={() =>
                  ingestCaseLaw.mutate(
                    {
                      text,
                      file,
                      source_url: sourceUrl.trim() || null,
                      source_id: sourceId || null,
                      original_filename: file?.name ?? null,
                      batch_id: null,
                      known: {
                        case_name: caseFields.case_name.trim() || undefined,
                        citation: caseFields.citation.trim(),
                        court: caseFields.court.trim(),
                        jurisdiction: caseFields.jurisdiction.trim(),
                        court_id: courtId || null,
                        jurisdiction_id: jurisdictionId || null,
                      },
                    },
                    {
                      onSuccess: (result) => navigate(ROUTES.caseLawDetail(result.caseLawId)),
                    },
                  )
                }
              >
                <FileText className="h-4 w-4" />
                Create draft Case Law record
              </Button>
            ) : (
              <Button
                disabled={
                  !canSubmitStatute || (!text.trim() && !file) || ingestLegislation.isPending
                }
                onClick={() =>
                  ingestLegislation.mutate(
                    {
                      text,
                      file,
                      source_url: sourceUrl.trim() || null,
                      source_id: sourceId || null,
                      original_filename: file?.name ?? null,
                      batch_id: null,
                      known: {
                        code: statuteFields.code.trim(),
                        title: statuteFields.title.trim(),
                        jurisdiction: statuteFields.jurisdiction.trim(),
                        short_title: statuteFields.short_title.trim() || undefined,
                        jurisdiction_id: jurisdictionId || null,
                      },
                    },
                    {
                      onSuccess: (result) => navigate(ROUTES.legislationDetail(result.statuteId)),
                    },
                  )
                }
              >
                <ScrollText className="h-4 w-4" />
                Create draft Act
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review Queue
// ---------------------------------------------------------------------------

function ReviewQueueTab() {
  const { data: caseLawQueue, isPending: caseLawPending } = useCaseLawReviewQueue();
  const { data: statuteQueue, isPending: statutePending } = useLegislationReviewQueue();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-foreground">Case Law</h2>
        {caseLawPending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : !caseLawQueue || caseLawQueue.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No Case Law drafts awaiting review.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {caseLawQueue.map((row) => (
              <CaseLawReviewCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-medium text-foreground">Legislation</h2>
        {statutePending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : !statuteQueue || statuteQueue.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No Legislation drafts awaiting review.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {statuteQueue.map((row) => (
              <StatuteReviewCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CaseLawReviewCard({ row }: { row: ReviewRow<CaseLaw> }) {
  const navigate = useNavigate();
  const update = useUpdateCanonicalCaseLaw(row.id);
  const setStatus = useSetCaseLawReviewStatus();
  const reject = useRejectCanonicalCaseLaw();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const { data: appliedTags } = useCaseLawTags(row.id);
  const applyTags = useApplyCaseLawTags(row.id);
  const [fields, setFields] = useState({
    case_name: row.case_name,
    citation: row.citation,
    court: row.court,
    jurisdiction: row.jurisdiction,
    court_id: row.court_id,
    jurisdiction_id: row.jurisdiction_id,
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const dirty =
    fields.case_name !== row.case_name ||
    fields.citation !== row.citation ||
    fields.court !== row.court ||
    fields.jurisdiction !== row.jurisdiction ||
    fields.court_id !== row.court_id ||
    fields.jurisdiction_id !== row.jurisdiction_id;

  const sourceName = row.source_id
    ? (sources ?? []).find((s) => s.id === row.source_id)?.name ?? "Unknown source"
    : null;
  const appliedTagNames = (appliedTags ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((n): n is string => !!n);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{row.case_name}</CardTitle>
            <Badge variant="outline">Case Law</Badge>
            {row.job_status && <Badge variant="secondary">{row.job_status}</Badge>}
          </div>
          <CardDescription>
            {row.review_status === "needs_review" ? "Needs review" : "Draft"} · Created{" "}
            {formatDate(row.created_at)}
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.caseLawDetail(row.id))}>
          View full record
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {row.duplicate_warning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{row.duplicate_warning}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Source: {sourceName ?? "unassigned"}</span>
          {row.source_url && (
            <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="underline">
              Source URL
            </a>
          )}
          <OriginalDocumentLink documentId={row.uploaded_document_id} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={fields.case_name}
            onChange={(e) => setFields((f) => ({ ...f, case_name: e.target.value }))}
            placeholder="Case name"
          />
          <Input
            value={fields.citation}
            onChange={(e) => setFields((f) => ({ ...f, citation: e.target.value }))}
            placeholder="Citation"
          />
          <Input
            value={fields.court}
            onChange={(e) => setFields((f) => ({ ...f, court: e.target.value }))}
            placeholder="Court (free text)"
          />
          <Input
            value={fields.jurisdiction}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="Jurisdiction (free text)"
          />
          <Select
            value={fields.jurisdiction_id ?? ""}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction_id: e.target.value || null }))}
          >
            <option value="">Canonical Jurisdiction — needs review</option>
            {(jurisdictions ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
          <Select
            value={fields.court_id ?? ""}
            onChange={(e) => setFields((f) => ({ ...f, court_id: e.target.value || null }))}
          >
            <option value="">Canonical deciding Court — needs review</option>
            {(courts ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.canonical_name}
              </option>
            ))}
          </Select>
        </div>

        <TagReviewEditor
          proposed={row.proposed_tags}
          applied={appliedTagNames}
          isSaving={applyTags.isPending}
          onSave={(names) => applyTags.mutate(names)}
        />

        <div className="flex flex-wrap justify-end gap-2">
          {dirty && (
            <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate(fields)}>
              Save edits
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmReject(true)}
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <Button
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: row.id, review_status: "published" })}
          >
            <CheckCircle2 className="h-4 w-4" />
            Publish
          </Button>
        </div>
      </CardContent>
      <AlertDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this draft?"
        description="This permanently deletes the draft Case Law record and its attached documents. This cannot be undone."
        confirmLabel="Reject and delete"
        confirmVariant="destructive"
        isConfirming={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { id: row.id, reason: "Rejected by curator during review." },
            { onSuccess: () => setConfirmReject(false) },
          )
        }
      />
    </Card>
  );
}

function StatuteReviewCard({ row }: { row: ReviewRow<Statute> }) {
  const navigate = useNavigate();
  const update = useUpdateCanonicalStatute(row.id);
  const setStatus = useSetStatuteReviewStatus();
  const reject = useRejectCanonicalStatute();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: provisions } = useStatuteProvisions(row.id);
  const { data: appliedTags } = useStatuteTags(row.id);
  const applyTags = useApplyStatuteTags(row.id);
  const [fields, setFields] = useState({
    title: row.title,
    code: row.code,
    jurisdiction: row.jurisdiction,
    chapter_number: row.chapter_number ?? "",
    jurisdiction_id: row.jurisdiction_id,
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const dirty =
    fields.title !== row.title ||
    fields.code !== row.code ||
    fields.jurisdiction !== row.jurisdiction ||
    fields.chapter_number !== (row.chapter_number ?? "") ||
    fields.jurisdiction_id !== row.jurisdiction_id;

  const sourceName = row.source_id
    ? (sources ?? []).find((s) => s.id === row.source_id)?.name ?? "Unknown source"
    : null;
  const appliedTagNames = (appliedTags ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((n): n is string => !!n);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{row.title}</CardTitle>
            <Badge variant="outline">Legislation</Badge>
            {row.job_status && <Badge variant="secondary">{row.job_status}</Badge>}
          </div>
          <CardDescription>
            {row.review_status === "needs_review" ? "Needs review" : "Draft"} · Created{" "}
            {formatDate(row.created_at)} · {(provisions ?? []).length} provision(s) extracted
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.legislationDetail(row.id))}>
          View full record
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {row.duplicate_warning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{row.duplicate_warning}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Source: {sourceName ?? "unassigned"}</span>
          {row.source_url && (
            <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="underline">
              Source URL
            </a>
          )}
          <OriginalDocumentLink documentId={row.uploaded_document_id} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={fields.title}
            onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title"
          />
          <Input
            value={fields.code}
            onChange={(e) => setFields((f) => ({ ...f, code: e.target.value }))}
            placeholder="Code"
          />
          <Input
            value={fields.jurisdiction}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="Jurisdiction (free text)"
          />
          <Input
            value={fields.chapter_number}
            onChange={(e) => setFields((f) => ({ ...f, chapter_number: e.target.value }))}
            placeholder="Chapter number"
          />
          <Select
            value={fields.jurisdiction_id ?? ""}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction_id: e.target.value || null }))}
          >
            <option value="">Canonical Jurisdiction — needs review</option>
            {(jurisdictions ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </div>

        <TagReviewEditor
          proposed={row.proposed_tags}
          applied={appliedTagNames}
          isSaving={applyTags.isPending}
          onSave={(names) => applyTags.mutate(names)}
        />

        <div className="flex flex-wrap justify-end gap-2">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ ...fields, chapter_number: fields.chapter_number || null })
              }
            >
              Save edits
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmReject(true)}
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <Button
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: row.id, review_status: "published" })}
          >
            <CheckCircle2 className="h-4 w-4" />
            Publish
          </Button>
        </div>
      </CardContent>
      <AlertDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this draft?"
        description="This permanently deletes the draft Legislation record and its provisions. This cannot be undone."
        confirmLabel="Reject and delete"
        confirmVariant="destructive"
        isConfirming={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { id: row.id, reason: "Rejected by curator during review." },
            { onSuccess: () => setConfirmReject(false) },
          )
        }
      />
    </Card>
  );
}
