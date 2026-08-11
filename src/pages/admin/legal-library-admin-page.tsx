import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
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
  useIngestCaseLaw,
  useIngestLegislation,
} from "@/hooks/legal-library/use-import-jobs";
import {
  useCaseLawReviewQueue,
  useUpdateCanonicalCaseLaw,
  useSetCaseLawReviewStatus,
  useRejectCanonicalCaseLaw,
} from "@/hooks/case-law/use-case-law";
import {
  useLegislationReviewQueue,
  useUpdateCanonicalStatute,
  useSetStatuteReviewStatus,
  useRejectCanonicalStatute,
} from "@/hooks/legislation/use-legislation";
import { readFileAsText } from "@/lib/legal-extraction";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";
import type { CaseLaw, Statute } from "@/types/database.types";

type ReviewRow<T> = T & { duplicate_warning: string | null };

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
  const [filename, setFilename] = useState<string | null>(null);
  const [caseFields, setCaseFields] = useState({ case_name: "", citation: "", court: "", jurisdiction: "" });
  const [statuteFields, setStatuteFields] = useState({ code: "", title: "", jurisdiction: "", short_title: "" });

  const ingestCaseLaw = useIngestCaseLaw();
  const ingestLegislation = useIngestLegislation();
  const navigate = useNavigate();

  async function handleFile(file: File) {
    setFilename(file.name);
    if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
      const read = await readFileAsText(file);
      setText(read);
      toast.success("Text read automatically from the .txt file.");
    } else {
      toast.warning(
        "This build has no PDF/DOCX text extractor. Open the file, copy the text, and paste it below — the filename is still recorded for provenance.",
      );
    }
  }

  const canSubmitCaseLaw =
    text.trim().length > 0 &&
    caseFields.citation.trim() &&
    caseFields.court.trim() &&
    caseFields.jurisdiction.trim();
  const canSubmitStatute =
    text.trim().length > 0 && statuteFields.code.trim() && statuteFields.title.trim() && statuteFields.jurisdiction.trim();

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
            {filename && <span className="text-xs text-muted-foreground">{filename}</span>}
          </div>

          <Input
            placeholder="Source URL (optional — provenance only, not fetched)"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />

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
                placeholder="Court *"
                value={caseFields.court}
                onChange={(e) => setCaseFields((f) => ({ ...f, court: e.target.value }))}
              />
              <Input
                placeholder="Jurisdiction *"
                value={caseFields.jurisdiction}
                onChange={(e) => setCaseFields((f) => ({ ...f, jurisdiction: e.target.value }))}
              />
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
            </div>
          )}

          <Textarea
            placeholder="Document text — auto-read for .txt uploads, pasted for PDF/DOCX…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
          />

          <div className="flex justify-end">
            {contentType === "case_law" ? (
              <Button
                disabled={!canSubmitCaseLaw || ingestCaseLaw.isPending}
                onClick={() =>
                  ingestCaseLaw.mutate(
                    {
                      text,
                      source_url: sourceUrl.trim() || null,
                      source_id: null,
                      original_filename: filename,
                      batch_id: null,
                      known: {
                        case_name: caseFields.case_name.trim() || undefined,
                        citation: caseFields.citation.trim(),
                        court: caseFields.court.trim(),
                        jurisdiction: caseFields.jurisdiction.trim(),
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
                disabled={!canSubmitStatute || ingestLegislation.isPending}
                onClick={() =>
                  ingestLegislation.mutate(
                    {
                      text,
                      source_url: sourceUrl.trim() || null,
                      source_id: null,
                      original_filename: filename,
                      batch_id: null,
                      known: {
                        code: statuteFields.code.trim(),
                        title: statuteFields.title.trim(),
                        jurisdiction: statuteFields.jurisdiction.trim(),
                        short_title: statuteFields.short_title.trim() || undefined,
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
  const [fields, setFields] = useState({
    case_name: row.case_name,
    citation: row.citation,
    court: row.court,
    jurisdiction: row.jurisdiction,
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const dirty =
    fields.case_name !== row.case_name ||
    fields.citation !== row.citation ||
    fields.court !== row.court ||
    fields.jurisdiction !== row.jurisdiction;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{row.case_name}</CardTitle>
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
            placeholder="Court"
          />
          <Input
            value={fields.jurisdiction}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="Jurisdiction"
          />
        </div>
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
        onConfirm={() => reject.mutate(row.id, { onSuccess: () => setConfirmReject(false) })}
      />
    </Card>
  );
}

function StatuteReviewCard({ row }: { row: ReviewRow<Statute> }) {
  const navigate = useNavigate();
  const update = useUpdateCanonicalStatute(row.id);
  const setStatus = useSetStatuteReviewStatus();
  const reject = useRejectCanonicalStatute();
  const [fields, setFields] = useState({
    title: row.title,
    code: row.code,
    jurisdiction: row.jurisdiction,
    chapter_number: row.chapter_number ?? "",
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const dirty =
    fields.title !== row.title ||
    fields.code !== row.code ||
    fields.jurisdiction !== row.jurisdiction ||
    fields.chapter_number !== (row.chapter_number ?? "");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{row.title}</CardTitle>
          <CardDescription>
            {row.review_status === "needs_review" ? "Needs review" : "Draft"} · Created{" "}
            {formatDate(row.created_at)}
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
            placeholder="Jurisdiction"
          />
          <Input
            value={fields.chapter_number}
            onChange={(e) => setFields((f) => ({ ...f, chapter_number: e.target.value }))}
            placeholder="Chapter number"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ ...fields, chapter_number: fields.chapter_number || null })}
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
        onConfirm={() => reject.mutate(row.id, { onSuccess: () => setConfirmReject(false) })}
      />
    </Card>
  );
}
