import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  FolderUp,
  Landmark,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
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
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { SaveIndicator, type SaveState } from "@/components/common/save-indicator";
import { toast } from "sonner";
import {
  useLegalSources,
  useCreateLegalSource,
  useDeleteLegalSource,
} from "@/hooks/legal-library/use-legal-sources";
import {
  useLegalJurisdictions,
  useLegalAuthorityCourts,
  useLegalRegionalGroups,
  useCreateLegalJurisdiction,
  useCreateLegalAuthorityCourt,
} from "@/hooks/legal-library/use-legal-taxonomy";
import {
  useIngestCaseLaw,
  useIngestLegislation,
  useImportBatches,
  useImportBatchDetail,
  useReprocessCaseLawExtraction,
  useReassessStatuteExtraction,
  readDuplicateOfId,
  readRejectedBeforeProcessing,
  readCancelledJob,
  type ImportBatchJobRow,
} from "@/hooks/legal-library/use-import-jobs";
import { useBulkImportCaseLaw } from "@/hooks/legal-library/use-bulk-import";
import {
  summarizeBulkQueue,
  BULK_STATUS_LABEL,
  type BulkItemStatus,
  validateFileForUpload,
} from "@/lib/bulk-ingestion-queue";
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
import { OCR_METADATA_PAGES } from "@/lib/ocr/constants";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { extractCaseLawMetadataWithConfidence, extractCaseNameFromFilename, normalizeWhitespace, shouldAutoFillCaseName, shouldProposeCaseName } from "@/lib/legal-extraction";
import { matchCanonicalCourtScored } from "@/lib/legal-taxonomy-match";
import {
  isPlaceholderValue,
  validateCaseLawForPublish,
  validateLegislationForPublish,
} from "@/lib/publication-validation";
import {
  emptyExtractionEnvelope,
  type ExtractionEnvelope,
} from "@/lib/extraction-pipeline";
import { CLEAN_SCORE_THRESHOLD, type QualityHardFailReason } from "@/lib/extraction-quality";
import {
  ingestDocument,
  ingestPastedText,
  ingestSuccessToast,
  INGEST_FILE_ACCEPT,
} from "@/lib/ingest-document";
import { ROUTES } from "@/routes/paths";
import { formatDate, formatDateTime, getErrorMessage } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { CaseLaw, Statute, LegalJurisdiction, LegalAuthorityCourt } from "@/types/database.types";

/** Small labeled-field wrapper — every editable Review Queue / New Import field renders through this so no field is ever identifiable only by placeholder text (§5). */
function Field({
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
 * Jurisdiction selects below — never a real row id, so it can't collide
 * with an actual uuid. */
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

/** Jurisdiction <Field>+<Select> with an inline "+ Add new Jurisdiction…" escape hatch — used everywhere Jurisdiction is selected (New Import, Review Queue). Never a free-text override; a new entry becomes a real canonical row so it never gets catalogued twice under different spellings. */
function JurisdictionField({
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
function CourtField({
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

type ReviewRow<T> = T & {
  duplicate_warning: string | null;
  proposed_tags: string[];
  uploaded_document_id: string | null;
  job_status: string | null;
  /** import_jobs.extracted_metadata — deterministic proposal fields plus, under `_extraction`, the full ExtractionEnvelope (status/method/quality/warnings/ocrUsed). Machine-derived, always a proposal, never silently promoted to canonical (§Phase 7). */
  extracted_metadata: unknown;
  job_error_summary: string | null;
};

/** Pulls the ExtractionEnvelope this draft was created with out of `extracted_metadata._extraction`, if present — older drafts created before this pass have none, which is treated as "pending" rather than an error. */
function readExtractionEnvelope(extractedMetadata: unknown): ExtractionEnvelope | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const envelope = (extractedMetadata as Record<string, unknown>)._extraction;
  if (!envelope || typeof envelope !== "object") return null;
  return envelope as ExtractionEnvelope;
}

/** Pulls the case-name metadata confidence recorded at ingest time (Phase 3/8) out of `extracted_metadata._metadataConfidence.caseName`, if present — older drafts created before this pass have none. */
function readCaseNameConfidence(extractedMetadata: unknown): "high" | "low" | "none" | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const confidence = (extractedMetadata as Record<string, unknown>)._metadataConfidence;
  if (!confidence || typeof confidence !== "object") return null;
  const caseName = (confidence as Record<string, unknown>).caseName;
  return caseName === "high" || caseName === "low" || caseName === "none" ? caseName : null;
}

/** Pulls WHERE the case name actually came from (`_metadataConfidence.caseNameSource` — Section 16/17/35-J: filename-derived metadata must be recorded and shown as such, never presented as if it came from the document text). `null` = not recorded (older draft, no case name at all, or Legislation). */
function readCaseNameSource(extractedMetadata: unknown): "document" | "filename" | "curator" | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const confidence = (extractedMetadata as Record<string, unknown>)._metadataConfidence;
  if (!confidence || typeof confidence !== "object") return null;
  const source = (confidence as Record<string, unknown>).caseNameSource;
  return source === "document" || source === "filename" || source === "curator" ? source : null;
}

/**
 * A single, plain-language PRIMARY state — deliberately just this
 * vocabulary (PRODUCTION DOCUMENT INGESTION PHASE, Section 7) and never a
 * raw score. Distinguishes CHARACTER quality (folded into the underlying
 * "extracted"/"low_quality"/"failed" status, since garbled characters
 * were always a hard-fail condition upstream) from STRUCTURAL quality
 * (envelope.structuralQuality — genuinely readable text that still isn't
 * reliable reading order) from METADATA confidence (caseNameConfidence —
 * a separate question about whether the PROPOSED case name specifically
 * can be trusted). This is exactly the three-way split the real Ramsingh
 * "100% quality, wrong case name" false success violated.
 */
type IngestionUiTone = "good" | "warn" | "bad" | "neutral";

/**
 * SIMPLE AND TIGHT ingestion pass: a "requires_ocr" document is not always
 * the same kind of problem — a protected PDF, a PDF using a font this
 * parser can't decode, and a genuinely scanned/image-only document are
 * three different situations with three different (specific, honest,
 * plain-language) primary labels, rather than one generic "OCR required"
 * badge for every case (see PdfUnreadableReason in pdf-text-extraction.ts
 * for the underlying diagnostic). `unreadableReason` is only ever set for
 * PDF text-layer extraction, so anything else (e.g. a non-PDF method, or no
 * reason recorded at all) falls back to the same honest default label.
 */
const OCR_REASON_LABEL: Record<string, string> = {
  encrypted: "Protected document",
  unsupported_font_encoding: "Could not read this document",
  no_text_found: "Scanned document — text recognition needed",
};

/** Plain-language label per QualityHardFailReason (extraction-quality.ts) — shown when a "failed" status has a specific, known cause, instead of one generic "Extraction failed" for every reason. */
const QUALITY_HARD_FAIL_LABEL: Record<QualityHardFailReason, string> = {
  too_short: "Extraction failed — too little text to be a real document",
  repeated_running_header: "Extraction failed — mostly a repeated page header/footer, not the document body",
  printable_ratio: "Extraction failed — text looks garbled",
  replacement_chars: "Extraction failed — unreadable characters from a font-decoding error",
  boilerplate: "Extraction failed — looks like embedded file metadata, not document content",
  control_chars: "Extraction failed — text contains unexpected control characters",
  structural_incoherence: "Extraction failed — text doesn't read as genuine prose",
};

function deriveIngestionUiState(
  envelope: ExtractionEnvelope,
  caseNameConfidence: "high" | "low" | "none" | null,
): { label: string; tone: IngestionUiTone } {
  if (envelope.status === "pending") return { label: "No text yet", tone: "neutral" };
  if (envelope.status === "failed") {
    const reason = envelope.hardFailReason;
    return { label: (reason && QUALITY_HARD_FAIL_LABEL[reason]) ?? "Extraction failed", tone: "bad" };
  }
  if (envelope.status === "requires_ocr") {
    return { label: OCR_REASON_LABEL[envelope.unreadableReason ?? ""] ?? "Could not read this document", tone: "warn" };
  }
  if (envelope.ocrUsed) {
    if (envelope.status === "low_quality" || envelope.structuralQuality === "poor") {
      return { label: "Scan recognized — please verify against the original", tone: "warn" };
    }
    return { label: "Text recognized from scan — please verify", tone: "warn" };
  }
  // "extracted" or "low_quality" from here — genuinely usable text exists.
  if (envelope.status === "low_quality" || envelope.structuralQuality === "poor") {
    return { label: "Text extracted — formatting requires review", tone: "warn" };
  }
  if (caseNameConfidence === "low") return { label: "Metadata confidence low — review required", tone: "warn" };
  if (caseNameConfidence === "none") return { label: "Metadata partially identified", tone: "warn" };
  return { label: "Text extracted successfully", tone: "good" };
}

const TONE_BADGE_VARIANT: Record<IngestionUiTone, "canonical" | "destructive" | "outline" | "secondary"> = {
  good: "canonical",
  bad: "destructive",
  warn: "outline",
  neutral: "secondary",
};

/**
 * Compact, reusable extraction-provenance readout — Review Queue §Phase 9:
 * "What did the machine determine? What remains uncertain?" answered in
 * one glance, without cluttering the card.
 *
 * WORDING FIX (Task 4, then PRODUCTION DOCUMENT INGESTION PHASE Section 7):
 * this used to show a bare "Quality: N%" figure taken directly from the
 * character-level quality score — which is exactly how a document with
 * clean, readable, but WRONG text (the real Ramsingh false-success case)
 * could display "Quality: 100%" right next to an incorrect proposed case
 * name, misleadingly implying the whole extraction — including the
 * proposed metadata — was fully trustworthy. This panel now shows ONE
 * plain-language primary state (see deriveIngestionUiState) drawn from
 * three genuinely independent signals — character quality, structural
 * quality, and metadata confidence — never a percentage. Technical detail
 * (warnings, page count, raw method) lives behind a collapsed "Extraction
 * details" disclosure so the normal card stays uncluttered.
 */
function ExtractionStatusPanel({
  envelope,
  caseNameConfidence = null,
  caseNameSource = null,
}: {
  envelope: ExtractionEnvelope | null;
  /** Only meaningful for Case Law; omitted entirely for Legislation (no case-name concept). `null`/undefined = not recorded (older draft, or Legislation). */
  caseNameConfidence?: "high" | "low" | "none" | null;
  /** Where the case name displayed on this draft actually came from (Section 16/17/35-J). A filename-derived name is real, useful information — but must never be shown as if the document text itself confirmed it. */
  caseNameSource?: "document" | "filename" | "curator" | null;
}) {
  if (!envelope || envelope.status === "pending") {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          No document text was extracted for this draft — Document text (if any) was entered manually.
        </p>
        {envelope?.warnings[0] && (
          <p className="text-xs text-muted-foreground">{envelope.warnings[0]}</p>
        )}
      </div>
    );
  }
  const methodLabel: Record<ExtractionEnvelope["method"], string> = {
    pdf_text_layer: "PDF text layer",
    txt_file: "Plain text file",
    markdown: "Markdown file",
    docx: "Word document",
    manual_paste: "Manually entered",
    ocr: "OCR",
    none: "—",
  };
  const state = deriveIngestionUiState(envelope, caseNameConfidence);
  const hasTechnicalDetail =
    envelope.warnings.length > 0 ||
    envelope.charCount > 0 ||
    envelope.pageCount > 0 ||
    (caseNameConfidence !== null && caseNameConfidence !== "high");

  return (
    <div className="space-y-1.5 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={TONE_BADGE_VARIANT[state.tone]}>{state.label}</Badge>
        <span className="text-muted-foreground">Source: {methodLabel[envelope.method]}</span>
        {envelope.pageCount > 0 && (
          <span className="text-muted-foreground">
            {envelope.pageCount} page{envelope.pageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {(envelope.status === "requires_ocr" || envelope.status === "failed") && (
        <p className="text-[11px] text-muted-foreground">
          {
            // The pipeline already builds a specific, honest, plain-language
            // reason (see reasonMessage in extraction-pipeline.ts) as the
            // first warning whenever nothing usable was extracted — show it
            // directly rather than one generic sentence for every cause.
            // Falls back to the original generic wording only if no
            // specific reason was recorded (should not normally happen).
            envelope.warnings[0] ??
              "This document requires OCR or manual text entry. The original file has been preserved, but reliable text could not be extracted automatically."
          }
        </p>
      )}
      {caseNameSource === "filename" && (
        <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Case name proposed from the file name, not the document text — please verify against the original before
          publishing.
        </p>
      )}
      {hasTechnicalDetail && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Extraction details</summary>
          <div className="mt-1 space-y-1 pl-3">
            <p>OCR used: {envelope.ocrUsed ? "Yes" : "No"}</p>
            {envelope.charCount > 0 && <p>{envelope.charCount.toLocaleString()} characters extracted</p>}
            {envelope.qualityScore !== null && envelope.qualityScore < CLEAN_SCORE_THRESHOLD && (
              <p className="text-amber-700 dark:text-amber-400">
                Below the automated clean-extraction threshold — verify the text against the original before publishing.
              </p>
            )}
            {caseNameConfidence && caseNameConfidence !== "high" && (
              <p className="text-amber-700 dark:text-amber-400">
                {caseNameConfidence === "low"
                  ? "Case name confidence: Low — the proposed case name was not confident enough to auto-fill. Please verify it against the document text before publishing."
                  : "Case name confidence: None — no case name could be confidently identified. Please enter it manually."}
              </p>
            )}
            {envelope.warnings.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 text-amber-700 dark:text-amber-400">
                {envelope.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** Pulls scored tag proposals recorded at ingest (`extracted_metadata.tag_proposals`). Older drafts have none. */
function readTagProposals(
  extractedMetadata: unknown,
  fallbackNames: string[],
): Array<{ name: string; confidence: "high" | "medium" | "low" }> {
  if (extractedMetadata && typeof extractedMetadata === "object") {
    const raw = (extractedMetadata as Record<string, unknown>).tag_proposals;
    if (Array.isArray(raw) && raw.length > 0) {
      const out: Array<{ name: string; confidence: "high" | "medium" | "low" }> = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        if (!name) continue;
        const conf = rec.confidence;
        const confidence =
          conf === "high" || conf === "medium" || conf === "low" ? conf : ("medium" as const);
        out.push({ name, confidence });
      }
      if (out.length > 0) return out;
    }
  }
  return fallbackNames.map((name) => ({ name, confidence: "medium" as const }));
}

/**
 * Compact chip-based tag reviewer shared by both Review Queue cards (§15/
 * §16): proposed tags from deterministic extraction (import_jobs.
 * proposed_tags) plus any already-applied canonical tags are shown as
 * toggleable chips; the reviewer can also add a free-text tag. Nothing is
 * written until "Save tags" is pressed — extraction proposes, it never
 * silently classifies.
 *
 * When nothing has been applied yet, only high-confidence proposals start
 * pre-selected. Medium/low appear as + until toggled. Save is still required.
 */
function TagReviewEditor({
  proposed,
  proposals,
  applied,
  onSave,
  isSaving,
}: {
  proposed: string[];
  /** Scored proposals from extracted_metadata.tag_proposals (fallback: medium). */
  proposals?: Array<{ name: string; confidence: "high" | "medium" | "low" }>;
  applied: string[];
  onSave: (names: string[]) => void;
  isSaving: boolean;
}) {
  const proposalList = proposals?.length
    ? proposals
    : proposed.map((name) => ({ name, confidence: "medium" as const }));
  const proposedNames = proposalList.map((p) => p.name);
  const highNames = proposalList.filter((p) => p.confidence === "high").map((p) => p.name);
  const confidenceByName = new Map(proposalList.map((p) => [p.name.toLowerCase(), p.confidence]));

  const initialSelected = () =>
    new Set(applied.length > 0 ? applied : highNames.length > 0 ? highNames : []);
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [customTag, setCustomTag] = useState("");
  const [allNames, setAllNames] = useState<string[]>(() =>
    Array.from(new Set([...applied, ...proposedNames])),
  );
  const [syncedApplied, setSyncedApplied] = useState(applied);
  const [syncedProposedKey, setSyncedProposedKey] = useState(() =>
    proposedNames.join("\0") + "|" + highNames.join("\0"),
  );
  useEffect(() => {
    const proposedKey = proposedNames.join("\0") + "|" + highNames.join("\0");
    const appliedChanged =
      applied.length !== syncedApplied.length || applied.some((t) => !syncedApplied.includes(t));
    const proposedChanged = proposedKey !== syncedProposedKey;
    if (!appliedChanged && !proposedChanged) return;
    setAllNames((prev) => Array.from(new Set([...prev, ...applied, ...proposedNames])));
    if (appliedChanged) {
      if (applied.length > 0) {
        setSelected(new Set(applied));
      } else if (highNames.length > 0) {
        setSelected(new Set(highNames));
      } else {
        setSelected(new Set());
      }
      setSyncedApplied(applied);
    } else if (proposedChanged && applied.length === 0 && syncedApplied.length === 0) {
      setSelected(new Set(highNames));
    }
    setSyncedProposedKey(proposedKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, proposedNames.join("\0"), highNames.join("\0")]);
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

  function handleSelectAllProposed() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const name of proposedNames) next.add(name);
      return next;
    });
    setAllNames((prev) => Array.from(new Set([...prev, ...proposedNames])));
  }

  function handleSelectHighConfidence() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const name of highNames) next.add(name);
      return next;
    });
    setAllNames((prev) => Array.from(new Set([...prev, ...highNames])));
  }

  function handleClearProposed() {
    const proposedLower = new Set(proposedNames.map((p) => p.toLowerCase()));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const name of prev) {
        if (!proposedLower.has(name.toLowerCase())) next.add(name);
      }
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Tags
          {proposedNames.length > 0
            ? " — suggested from document keywords (confidence shown); review, then Save tags"
            : ""}
        </p>
        {proposedNames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {highNames.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={handleSelectHighConfidence}
                aria-label="Select high confidence proposed tags"
              >
                Select high confidence
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={handleSelectAllProposed}
              aria-label="Select all proposed tags"
            >
              Select all proposed
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={handleClearProposed}
              aria-label="Clear proposed tags from selection"
            >
              Clear proposed
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {allNames.length === 0 && (
          <span className="text-xs text-muted-foreground">No tags proposed.</span>
        )}
        {allNames.map((name) => {
          const conf = confidenceByName.get(name.toLowerCase());
          const title = conf ? `${name} (${conf} confidence)` : name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              aria-pressed={selected.has(name)}
              aria-label={`${selected.has(name) ? "Deselect" : "Select"} tag ${name}${conf ? `, ${conf} confidence` : ""}`}
              title={title}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                selected.has(name)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {selected.has(name) ? "✓ " : "+ "}
              {name}
              {conf ? (
                <span className="ml-1 text-[10px] opacity-70">{conf}</span>
              ) : null}
            </button>
          );
        })}
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
          aria-label="Add a custom tag"
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
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (e) {
          // Deliberately does not surface e.message -- that's raw
          // Supabase/Storage internals, not a safe user-facing string
          // (Section 38). Log the detail for debugging instead.
          console.error("Could not open original document:", e);
          toast.error(
            "Could not open the original file — it may have been removed from storage, or your session may have expired. Try again.",
          );
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
 * - PDF, .txt, Markdown, and .docx are extracted locally in the browser.
 *   Scanned PDFs and images use on-device OCR. Word 97–2003 (.doc) cannot
 *   be parsed — paste the text or save as .docx. Short files stay pending
 *   until the curator pastes usable text.
 * - URL/source-adapter fetching is NOT implemented (no verified safe
 *   server-side fetch infrastructure in this environment) — Sources here
 *   are a reviewable REGISTRY only; adding one does not trigger a crawl.
 * - Tag proposals are keyword/rule-based, not AI. No AI classification is
 *   configured in this build.
 */
const VALID_TABS = ["sources", "import", "batches", "review"] as const;
type LegalLibraryTab = (typeof VALID_TABS)[number];

export default function LegalLibraryAdminPage() {
  // Controlled by the URL (not local-only state) specifically so a link
  // FROM elsewhere — bulk-import results, a Batch Detail row, a
  // Review-not-View action — can deep-link straight into the right tab
  // (and, for Review Queue, the right card) instead of dumping the
  // curator on the page and making them re-navigate. See
  // ROUTES.adminLegalLibraryReviewCaseLaw/adminLegalLibraryBatch.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: LegalLibraryTab = VALID_TABS.includes(tabParam as LegalLibraryTab)
    ? (tabParam as LegalLibraryTab)
    : "import";
  const highlightCaseLawId = searchParams.get("caseLaw");
  const initialBatchId = searchParams.get("batch");
  // Same `batch` param, read again under a name that makes sense on the
  // Review Queue tab: "which batch did this deep link come FROM" (so the
  // card can offer "Back to batch") rather than "which batch to OPEN"
  // (ImportBatchesTab's meaning for the same param, above).
  const reviewFromBatchId = activeTab === "review" ? initialBatchId : null;

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    // Switching tabs manually clears any deep-link target from a
    // previous navigation so it doesn't keep re-highlighting/re-opening
    // stale state after the curator has moved on.
    if (value !== "review") next.delete("caseLaw");
    if (value !== "review") next.delete("statute");
    if (value !== "batches") next.delete("batch");
    setSearchParams(next, { replace: true });
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Legal Library"
        description="Manage source registrations, ingest Case Law and Legislation, and review drafts before they become canonical."
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="import">New Import</TabsTrigger>
          <TabsTrigger value="batches">Import Batches</TabsTrigger>
          <TabsTrigger value="review">Review Queue</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <SourcesTab />
        </TabsContent>
        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
        <TabsContent value="batches">
          <ImportBatchesTab initialBatchId={initialBatchId} />
        </TabsContent>
        <TabsContent value="review">
          <ReviewQueueTab highlightCaseLawId={highlightCaseLawId} fromBatchId={reviewFromBatchId} />
        </TabsContent>
      </Tabs>
    </BrowsePage>
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

/** Human labels for raw `legal_sources.status` values (Section 23: no raw enum tokens in the UI). */
const SOURCE_STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  testing: "Testing",
  approved: "Approved",
  disabled: "Disabled",
  failed: "Failed",
};

/** Mirrors the option labels in the "Register a source" form below — reused here so the Sources list shows the same human wording instead of the raw `source_type` token (Section 23). */
const SOURCE_TYPE_LABEL: Record<string, string> = {
  case_law: "Case Law source",
  legislation: "Legislation source",
  mixed: "Mixed (both)",
};

/** Mirrors the option labels in the "Register a source" form below — reused here so the Sources list shows the same human wording instead of the raw `connector_type` token (Section 23). */
const CONNECTOR_TYPE_LABEL: Record<string, string> = {
  manual: "Manual",
  direct_document: "Direct document",
  html_document: "HTML document",
  index_page: "Index page",
  structured_feed: "Structured feed",
  custom_adapter: "Custom adapter",
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
                      {SOURCE_STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                    {s.canonical_trusted && <Badge variant="canonical">Trusted</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      s.jurisdiction,
                      SOURCE_TYPE_LABEL[s.source_type] ?? s.source_type,
                      CONNECTOR_TYPE_LABEL[s.connector_type] ?? s.connector_type,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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

const EMPTY_CASE_FIELDS = { case_name: "", citation: "", decided_date: "" };
const EMPTY_STATUTE_FIELDS = { code: "", title: "", short_title: "" };

function ImportTab() {
  // Single-document import (the original flow) vs. Bulk import (Section
  // 10-13: select 1, 20, 200, or a whole folder at once). Deliberately a
  // sub-mode of the same tab rather than a brand-new top-level tab — New
  // Import is still fundamentally one workflow with two entry points, and
  // single-document import must not become more cumbersome to reach.
  const [importMode, setImportMode] = useState<"single" | "bulk">("single");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => setImportMode("single")}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            importMode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Single document
        </button>
        <button
          type="button"
          onClick={() => setImportMode("bulk")}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            importMode === "bulk" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Bulk import
        </button>
      </div>
      {importMode === "single" ? <SingleImportPanel /> : <BulkImportPanel />}
    </div>
  );
}

function SingleImportPanel() {
  const [contentType, setContentType] = useState<"case_law" | "legislation">("case_law");
  const [text, setText] = useState("");
  const [courtId, setCourtId] = useState<string>("");
  const [jurisdictionId, setJurisdictionId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [extractionEnvelope, setExtractionEnvelope] = useState<ExtractionEnvelope>(emptyExtractionEnvelope());
  /** Case-name metadata confidence for the CURRENT file (Phase 3/8) — surfaced live in the New Import panel, not just after the draft is created. `null` = not yet computed / no case name found at all. */
  const [caseNameConfidence, setCaseNameConfidence] = useState<"high" | "low" | "none" | null>(null);
  // Case name/citation/decided date are the only free-text metadata the
  // curator ever types for Case Law now — Court/Jurisdiction are captured
  // ONCE via the canonical selects below, never as a second parallel
  // free-text pair (§2/§25: "should not have to catalog the same legal
  // authority twice").
  const [caseFields, setCaseFields] = useState(EMPTY_CASE_FIELDS);
  const [statuteFields, setStatuteFields] = useState(EMPTY_STATUTE_FIELDS);

  const ingestCaseLaw = useIngestCaseLaw();
  const ingestLegislation = useIngestLegislation();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const navigate = useNavigate();

  const selectedCourt = (courts ?? []).find((c) => c.id === courtId) ?? null;

  /** Selecting a canonical Court auto-populates Jurisdiction where the court has one on file (§3/§4) — a national court like "Court of Appeal of Guyana" always carries its Jurisdiction; a regional/supranational court (CCJ, JCPC) has `jurisdiction_id: null` in the catalogue and is deliberately left for the curator to set explicitly rather than forcing one nation onto it. Takes the full court object (not just an id) so a just-created Court (see CourtField/AddCourtDialog) works identically to an existing one — the freshly-created row isn't in the `courts` list yet at the moment of selection, since query invalidation is async. */
  function handleCourtChange(court: LegalAuthorityCourt | null) {
    setCourtId(court?.id ?? "");
    if (court?.jurisdiction_id) {
      setJurisdictionId(court.jurisdiction_id);
    }
  }

  /**
   * DATA-INTEGRITY FIX (holistic ingestion repair, Phase 2): confirmed live
   * bug — after a PDF's text/metadata was successfully extracted, selecting
   * a DIFFERENT PDF that failed to extract left the FIRST document's case
   * name, citation, court, and jurisdiction sitting in the form, with
   * nothing to indicate they belonged to a different file. A curator could
   * then unknowingly publish File B's original document paired with File
   * A's metadata. This must be impossible: every field derived from a
   * previously selected file is cleared SYNCHRONOUSLY, before any async
   * extraction work starts for the new file — never conditionally, never
   * only on the success path.
   */
  function resetFileDerivedState() {
    setText("");
    setCourtId("");
    setJurisdictionId("");
    setCaseFields(EMPTY_CASE_FIELDS);
    setStatuteFields(EMPTY_STATUTE_FIELDS);
    setExtractionEnvelope(emptyExtractionEnvelope());
    setCaseNameConfidence(null);
  }

  async function handleFile(f: File) {
    // Same client-side pre-check bulk mode already runs (Section 38): catch
    // an oversized/empty/unsupported file here, with a specific message,
    // rather than letting it fail later at the Storage upload boundary with
    // a raw Storage API error the curator can't act on.
    const validation = validateFileForUpload(f);
    if (!validation.ok) {
      toast.error(validation.reason ?? "This file can't be used.");
      return;
    }
    resetFileDerivedState();
    // The original file is ALWAYS kept and uploaded through the secure
    // documents Storage architecture on submit (uploadDocumentToEntity,
    // private bucket, signed URLs only) — selecting a PDF/DOCX never
    // discards the file itself, and a failed/low-quality extraction never
    // prevents the file from being preserved.
    setFile(f);
    setExtractionEnvelope((prev) => ({ ...prev, status: "pending" }));
    const envelope = await ingestDocument(f);
    applyExtractionResult(envelope);

    const fromFilename = extractCaseNameFromFilename(f.name);
    const filenameCitation = fromFilename?.reported_citation ?? fromFilename?.neutral_citation ?? "";

    if (envelope.status === "extracted" || envelope.status === "low_quality") {
      toast.success(ingestSuccessToast(envelope));
      if (contentType === "case_law") {
        const normalizedPages = envelope.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeWhitespace(p.text) }));
        const { fields: proposed, caseNameConfidence: computedConfidence } = extractCaseLawMetadataWithConfidence(
          normalizeWhitespace(envelope.text),
          normalizedPages,
          { filename: f.name },
        );
        setCaseNameConfidence(computedConfidence);
        const proposeName = shouldProposeCaseName(computedConfidence, envelope.ocrUsed);
        const highFill = shouldAutoFillCaseName(computedConfidence, envelope.ocrUsed);
        setCaseFields({
          case_name: proposeName ? (proposed.case_name ?? "") : "",
          citation: filenameCitation || proposed.reported_citation || proposed.neutral_citation || "",
          decided_date: proposed.decided_date_guess ?? "",
        });
        if (proposed.case_name && proposeName && !highFill) {
          toast.message(
            `A possible case name was found ("${proposed.case_name}") — please verify it against the original before publishing.`,
          );
        } else if (proposed.case_name && !proposeName) {
          toast.message(
            envelope.ocrUsed
              ? `A possible case name was recognized ("${proposed.case_name}") but was not auto-filled because this text came from a scan — please verify it against the original.`
              : `A possible case name was found ("${proposed.case_name}") but was not confident enough to auto-fill — please review the extracted text and enter the case name manually.`,
          );
        }
        // Only auto-select on "high"/"medium" confidence — a mention of
        // some other court deep in the judgment body (a common pattern:
        // Caribbean appellate judgments discussing further appeal rights
        // to the Privy Council) must never outrank an explicit
        // deciding-court heading, and a low-confidence guess is worse
        // than leaving Court for the curator to set (§10).
        const matched = matchCanonicalCourtScored(envelope.text, courts ?? []);
        if (matched && matched.confidence !== "low") {
          setCourtId(matched.court.id);
          if (matched.court.jurisdiction_id) setJurisdictionId(matched.court.jurisdiction_id);
          if (matched.confidence === "medium") {
            toast.message(
              `Court proposed from extracted text: ${matched.court.canonical_name} — please confirm before publishing.`,
            );
          }
        }
      }
      // Legislation: no automatic Act title/code proposal exists yet —
      // deliberately not inventing a fixture-driven heuristic for this
      // pass (Phase 12 wires the SAME extraction/quality/sanitize
      // pipeline into Legislation ingestion; structural parsing of
      // Parts/Sections already runs downstream in useIngestLegislation
      // over whatever text this produces).
      return;
    }

    if (envelope.status === "requires_ocr") {
      toast.message(
        envelope.warnings[0] ??
          "This document requires OCR. The original file has been preserved, but reliable text could not be extracted automatically — paste the text below to continue, or leave it for later.",
      );
      if (contentType === "case_law" && filenameCitation) {
        setCaseFields((prev) => ({ ...prev, citation: filenameCitation }));
      }
    } else if (envelope.status === "failed") {
      toast.warning(
        "Automatic extraction produced text that failed quality checks (it looks like embedded PDF/font data rather than document content) and was discarded. The original file has been preserved — paste the text below to continue.",
      );
    } else if (envelope.status === "pending") {
      toast.message(
        envelope.warnings[0] ??
          "Original file will be uploaded and preserved. Paste the text below to continue, or leave it for later from the Review Queue.",
      );
    }
  }

  function applyExtractionResult(envelope: ExtractionEnvelope) {
    setExtractionEnvelope(envelope);
    setText(envelope.text);
  }

  /** Curator typing/pasting directly into Document text is trusted manual input, not a machine proposal — tracked as its own extraction method so the Review Queue shows "Manually entered" rather than a stale PDF-extraction status once the curator starts editing. */
  function handleTextChange(value: string) {
    setText(value);
    if (extractionEnvelope.method !== "manual_paste") {
      setExtractionEnvelope(ingestPastedText(value));
    }
  }

  const canSubmitCaseLaw = caseFields.citation.trim() && courtId && jurisdictionId;
  const canSubmitStatute =
    statuteFields.code.trim() && statuteFields.title.trim() && jurisdictionId;

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
                accept={INGEST_FILE_ACCEPT}
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
            {extractionEnvelope.status === "pending" && file && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" />
                Extracting text…
              </Badge>
            )}
          </div>

          {file && extractionEnvelope.status !== "pending" && (
            <ExtractionStatusPanel
              envelope={extractionEnvelope}
              caseNameConfidence={contentType === "case_law" ? caseNameConfidence : null}
            />
          )}

          {contentType === "case_law" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Case name" hint="Proposed from extracted text if left blank.">
                <Input
                  value={caseFields.case_name}
                  onChange={(e) => setCaseFields((f) => ({ ...f, case_name: e.target.value }))}
                />
              </Field>
              <Field label="Citation" required>
                <Input
                  value={caseFields.citation}
                  onChange={(e) => setCaseFields((f) => ({ ...f, citation: e.target.value }))}
                />
              </Field>
              <Field label="Decision date">
                <DateOnlyInput
                  value={caseFields.decided_date}
                  onChange={(v) => setCaseFields((f) => ({ ...f, decided_date: v }))}
                />
              </Field>
              <JurisdictionField
                value={jurisdictionId || null}
                onChange={(id) => setJurisdictionId(id ?? "")}
                jurisdictions={jurisdictions ?? []}
                hint={
                  selectedCourt?.jurisdiction_id
                    ? "Auto-set from the selected Court."
                    : "This court spans multiple jurisdictions — set explicitly."
                }
              />
              <CourtField
                value={courtId || null}
                onChange={handleCourtChange}
                courts={courts ?? []}
                hint="Selecting a Court automatically sets Jurisdiction where known — no need to enter both."
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" required hint="Short identifier, unique per jurisdiction.">
                <Input
                  value={statuteFields.code}
                  onChange={(e) => setStatuteFields((f) => ({ ...f, code: e.target.value }))}
                />
              </Field>
              <Field label="Title" required>
                <Input
                  value={statuteFields.title}
                  onChange={(e) => setStatuteFields((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <Field label="Short title">
                <Input
                  value={statuteFields.short_title}
                  onChange={(e) => setStatuteFields((f) => ({ ...f, short_title: e.target.value }))}
                />
              </Field>
              <JurisdictionField
                value={jurisdictionId || null}
                onChange={(id) => setJurisdictionId(id ?? "")}
                jurisdictions={jurisdictions ?? []}
              />
            </div>
          )}

          <Field label="Document text" hint="Read automatically from PDFs, Word (.docx), Markdown, text files, and images. Paste manually for Word 97–2003 (.doc) or when extraction needs a check.">
            <Textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={10}
            />
          </Field>
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
                      extractionEnvelope,
                      source_url: null,
                      source_id: null,
                      original_filename: file?.name ?? null,
                      batch_id: null,
                      known: {
                        case_name: caseFields.case_name.trim() || undefined,
                        citation: caseFields.citation.trim(),
                        // Legacy free-text columns are NOT typed separately by
                        // the curator — they're derived automatically from
                        // the canonical selection above (§2/§3/§19: the
                        // NOT NULL free-text columns stay populated for
                        // backward compatibility without ever asking the
                        // curator to catalog the same Court/Jurisdiction
                        // twice).
                        court: (courts ?? []).find((c) => c.id === courtId)?.canonical_name ?? "",
                        jurisdiction: (jurisdictions ?? []).find((j) => j.id === jurisdictionId)?.name ?? "",
                        court_id: courtId || null,
                        jurisdiction_id: jurisdictionId || null,
                        decided_date: caseFields.decided_date || null,
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
                      extractionEnvelope,
                      source_url: null,
                      source_id: null,
                      original_filename: file?.name ?? null,
                      batch_id: null,
                      known: {
                        code: statuteFields.code.trim(),
                        title: statuteFields.title.trim(),
                        jurisdiction: (jurisdictions ?? []).find((j) => j.id === jurisdictionId)?.name ?? "",
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

const BULK_STATUS_TONE: Record<BulkItemStatus, "canonical" | "destructive" | "outline" | "secondary"> = {
  queued: "secondary",
  hashing: "secondary",
  duplicate: "outline",
  extracting: "secondary",
  needs_review: "outline",
  ready: "canonical",
  failed: "destructive",
  completed: "canonical",
  rejected: "destructive",
  cancelled: "outline",
};

function BulkSummaryChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "canonical" | "destructive" | "outline" | "secondary";
}) {
  if (count === 0) return null;
  return (
    <Badge variant={tone} className="gap-1">
      {label}: {count}
    </Badge>
  );
}

/**
 * Bulk import — Case Law only for this pass (Section 22: the architecture
 * is generic, but only Case Law's per-file metadata proposal is wired into
 * the bulk worker so far; Legislation's structural Part/Section parsing
 * stays on the single-document flow). Deliberately reuses the exact same
 * per-file pipeline as SingleImportPanel via useBulkImportCaseLaw — see
 * that hook's doc comment. Every file becomes its own draft in the Review
 * Queue; nothing here ever publishes anything (Section 3/21: "BULK
 * INGESTION IS NOT BULK PUBLICATION").
 */
function BulkImportPanel() {
  const { items, isRunning, startBulkImport, cancelBulkImport, reset, lastBatchId, retryItem } = useBulkImportCaseLaw();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const navigate = useNavigate();

  const summary = summarizeBulkQueue(items);
  const hasItems = items.length > 0;
  // Phase P (Section 20): "simple progress presentation... not queue
  // internals" — a plain "Processing 18 of 50 documents..." readout rather
  // than a static, uninformative "Processing…" badge with no indication of
  // how far through a large batch the run actually is. A document counts
  // as "done" once it has reached any terminal per-item status (ready,
  // needs_review, duplicate, failed, rejected, completed) — still queued/
  // hashing/extracting counts as in progress.
  const doneCount =
    summary.ready + summary.completed + summary.needs_review + summary.duplicate + summary.failed + summary.rejected + summary.cancelled;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    void startBulkImport(files, {
      sourceId: null,
      sourceName: null,
      courts: courts ?? [],
      jurisdictions: (jurisdictions ?? []).map((j) => ({ id: j.id, name: j.name })),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk import — Case Law</CardTitle>
        <CardDescription>
          Select many judgments at once — individual files or an entire folder. Each file is preserved,
          hashed, and processed independently with bounded concurrency; one bad file never stops the batch.
          Every file becomes its own draft in the Review Queue — nothing is published automatically.
          Legislation bulk import isn&apos;t available yet; use Single document for Acts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted ${
              isRunning ? "pointer-events-none opacity-50" : "cursor-pointer"
            }`}
          >
            <Upload className="h-4 w-4" />
            Upload files
            <input
              type="file"
              multiple
              accept={INGEST_FILE_ACCEPT}
              className="hidden"
              disabled={isRunning}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label
            className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted ${
              isRunning ? "pointer-events-none opacity-50" : "cursor-pointer"
            }`}
          >
            <FolderUp className="h-4 w-4" />
            Upload folder
            <input
              type="file"
              multiple
              // Non-standard attribute, not in React's JSX typings, but
              // supported by Chromium/Firefox/Safari file pickers — where
              // unsupported it degrades to a normal multi-file picker, so
              // basic multi-file selection still works everywhere (§10:
              // folder selection must not be the ONLY mechanism).
              // @ts-expect-error -- webkitdirectory is non-standard
              webkitdirectory=""
              className="hidden"
              disabled={isRunning}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {isRunning && (
            <>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" />
                {items.length > 0 ? `Processing ${doneCount} of ${items.length}…` : "Processing…"}
              </Badge>
              <Button size="sm" variant="outline" onClick={cancelBulkImport}>
                Cancel
              </Button>
            </>
          )}
          {hasItems && !isRunning && lastBatchId && (
            // The persistent record (Import Batches), not this temporary
            // in-memory list, is where this batch actually lives once the
            // curator navigates away (Section 18) — offer the handoff
            // immediately rather than leaving them to find it themselves.
            <Button size="sm" onClick={() => navigate(ROUTES.adminLegalLibraryBatch(lastBatchId))}>
              Open batch
            </Button>
          )}
          {hasItems && !isRunning && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Clear
            </Button>
          )}
        </div>

        {hasItems && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <BulkSummaryChip label="Ready" count={summary.ready + summary.completed} tone="canonical" />
              <BulkSummaryChip label="Needs review" count={summary.needs_review} tone="outline" />
              <BulkSummaryChip label="Duplicates" count={summary.duplicate} tone="outline" />
              <BulkSummaryChip
                label="Processing"
                count={summary.queued + summary.hashing + summary.extracting}
                tone="secondary"
              />
              <BulkSummaryChip label="Failed" count={summary.failed} tone="destructive" />
              <BulkSummaryChip label="Rejected" count={summary.rejected} tone="destructive" />
              <BulkSummaryChip label="Cancelled" count={summary.cancelled} tone="outline" />
            </div>

            <div className="max-h-[28rem] space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{item.file.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.error && (
                      <span className="max-w-[16rem] truncate text-destructive" title={item.error}>
                        {item.error}
                      </span>
                    )}
                    {item.duplicateReason && (
                      <span className="max-w-[16rem] truncate text-muted-foreground" title={item.duplicateReason}>
                        {item.duplicateReason}
                      </span>
                    )}
                    {item.progressNote && item.status === "extracting" && (
                      <span className="max-w-[16rem] truncate text-muted-foreground" title={item.progressNote}>
                        {item.progressNote}
                      </span>
                    )}
                    <Badge variant={BULK_STATUS_TONE[item.status]}>{BULK_STATUS_LABEL[item.status]}</Badge>
                    {item.caseLawId && (
                      // Bulk import NEVER auto-publishes (§3/§21) — every
                      // successful item is a DRAFT, so "View" (the
                      // read-only canonical reader, which also cannot
                      // edit a canonical/owner_id-null row at all) is
                      // always the wrong destination here. "Review" opens
                      // the same admin Review Queue workflow a curator
                      // would reach by searching for it manually.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() =>
                          navigate(ROUTES.adminLegalLibraryReviewCaseLaw(item.caseLawId!, lastBatchId ?? undefined))
                        }
                      >
                        Review
                      </Button>
                    )}
                    {item.status === "failed" && (
                      // Same-session-only (Section 17): the original File
                      // object only survives while this queue is still in
                      // memory, so Retry cannot appear once the curator
                      // has left/reloaded the page — Batch Detail's rows
                      // (persisted, cross-session) intentionally have no
                      // Retry button for that reason. Reuses the exact
                      // same batch_id and pipeline as the original attempt,
                      // so a successful retry lands in the same batch
                      // rather than creating a disconnected one.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        disabled={isRunning}
                        onClick={() => void retryItem(item.id)}
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Import Batches — persistent bulk-ingestion history + batch detail
// ---------------------------------------------------------------------------

/**
 * Vocabulary for import_jobs.status (0055's original 8 values + 0063's
 * 'duplicate') — a job processing status, genuinely distinct from
 * review_status on the linked case_law/statutes row (which only exists
 * once a draft was actually created). Kept local to this section since
 * it's the only place a raw job status is rendered directly to a curator.
 */
const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  fetching: "Fetching",
  extracting: "Extracting",
  structuring: "Structuring",
  needs_review: "Needs review",
  ready: "Ready",
  published: "Published",
  failed: "Failed",
  duplicate: "Duplicate",
};

const JOB_STATUS_TONE: Record<string, "canonical" | "destructive" | "outline" | "secondary"> = {
  queued: "secondary",
  fetching: "secondary",
  extracting: "secondary",
  structuring: "secondary",
  needs_review: "outline",
  ready: "outline",
  published: "canonical",
  failed: "destructive",
  duplicate: "outline",
};

function batchJobDisplayStatus(row: ImportBatchJobRow): { label: string; tone: "canonical" | "destructive" | "outline" | "secondary" } {
  if (row.status === "failed" && readRejectedBeforeProcessing(row.extracted_metadata)) {
    return { label: "Rejected", tone: "destructive" }
  }
  if (row.status === "failed" && readCancelledJob(row.extracted_metadata)) {
    return { label: "Cancelled", tone: "outline" }
  }
  return {
    label: JOB_STATUS_LABEL[row.status] ?? row.status,
    tone: JOB_STATUS_TONE[row.status] ?? "secondary",
  }
}

/**
 * The batch accounting invariant (Section 5), rendered honestly:
 *  - `expected_file_count === null` — this batch predates the persistent
 *    bare-job-row architecture (0063/0064); its true original selection
 *    size was never recorded and cannot be reconstructed. Say so, rather
 *    than silently showing a job count that looks like the whole story.
 *  - `total < expected_file_count` — should not happen for a completed
 *    batch going forward, but if it does (still processing, or a rare
 *    persistence failure), show both numbers rather than pretend nothing
 *    is missing.
 *  - otherwise — the invariant holds; show the plain count.
 */
function BatchCountSummary({
  batch,
}: {
  batch: { total: number; expected_file_count: number | null; isLegacyIncomplete: boolean; isFullyAccounted: boolean };
}) {
  if (batch.isLegacyIncomplete) {
    return (
      <span title="Created before per-file outcomes were persisted for every result — some files' fates were never recorded.">
        {batch.total} document{batch.total === 1 ? "" : "s"} on record (legacy — incomplete history)
      </span>
    );
  }
  if (!batch.isFullyAccounted) {
    return (
      <span title="Still processing, or an outcome failed to save — refresh to check for updates.">
        {batch.total} of {batch.expected_file_count} documents recorded
      </span>
    );
  }
  return (
    <span>
      {batch.total} document{batch.total === 1 ? "" : "s"}
    </span>
  );
}

/**
 * Import Batches — the persistent operational view "what happened to the
 * files I uploaded together?" (Section 6/21), distinct from Review Queue
 * (Section 12: "the authoritative list of unpublished material"). Every
 * batch and every job row here comes from a live query, not component
 * state — leaving this tab, refreshing the browser, or coming back
 * tomorrow all show the same data (Section 34's core product principle).
 */
function ImportBatchesTab({ initialBatchId }: { initialBatchId?: string | null }) {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(initialBatchId ?? null);
  const { data: batches, isPending, isError, error, refetch } = useImportBatches();

  // A deep link (Section 21: click a batch → Batch Detail) always wins
  // over whatever was previously selected in this session.
  useEffect(() => {
    if (initialBatchId) setSelectedBatchId(initialBatchId);
  }, [initialBatchId]);

  if (selectedBatchId) {
    return <BatchDetailView batchId={selectedBatchId} onBack={() => setSelectedBatchId(null)} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Import batches</CardTitle>
            <CardDescription>
              Every bulk import you've run, with what happened to each file. Return to any batch after
              navigating away or refreshing — nothing here is temporary.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
      </Card>

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !batches || batches.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FolderUp}
              className="border-0"
              title="No import batches yet"
              description="Batches created from Bulk Import (New Import → Bulk import) will appear here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <Card
              key={b.id}
              className="cursor-pointer transition-colors hover:bg-muted/40"
              onClick={() => setSelectedBatchId(b.id)}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{b.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(b.created_at)} · <BatchCountSummary batch={b} /> ·{" "}
                    {b.content_type === "case_law" ? "Case Law" : "Legislation"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(b.counts).map(([status, count]) => (
                    <Badge key={status} variant={JOB_STATUS_TONE[status] ?? "secondary"}>
                      {JOB_STATUS_LABEL[status] ?? status}: {count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchDetailView({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useImportBatchDetail(batchId);

  const rows = data?.rows ?? [];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  // Content-quality summary at a glance (Batch Detail already exists as
  // the natural "184-row audit" surface — no separate page needed). Only
  // counts rows with a linked draft; bare duplicate/failed job rows have
  // nothing to grade.
  const qualityCounts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.contentQualityStatus) continue;
    qualityCounts[r.contentQualityStatus] = (qualityCounts[r.contentQualityStatus] ?? 0) + 1;
  }
  const QUALITY_LABEL: Record<string, string> = { good: "Good", fair: "Fair", poor: "Poor", failed: "Failed", unknown: "Unassessed" };
  const QUALITY_TONE: Record<string, "canonical" | "destructive" | "outline" | "secondary"> = {
    good: "canonical",
    fair: "outline",
    poor: "destructive",
    failed: "destructive",
    unknown: "secondary",
  };

  // "Review" from a batch row jumps to that ONE record; "Next needs
  // review" (Section 11) walks the curator through every remaining
  // needs_review item in this SAME batch without making them return to
  // Import Batches and reopen it each time.
  const needsReviewIds = rows.filter((r) => r.status === "needs_review" && r.target_case_law_id).map((r) => r.target_case_law_id as string);

  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Back to batches
      </Button>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError || !data ? (
        <InlineError error={error ?? new Error("Batch not found.")} onRetry={() => void refetch()} />
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">{data.batch.label}</CardTitle>
                <CardDescription>
                  {formatDateTime(data.batch.created_at)} ·{" "}
                  <BatchCountSummary
                    batch={{
                      total: rows.length,
                      expected_file_count: data.expected_file_count,
                      isLegacyIncomplete: data.isLegacyIncomplete,
                      isFullyAccounted: data.isFullyAccounted,
                    }}
                  />
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {needsReviewIds.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => navigate(ROUTES.adminLegalLibraryReviewCaseLaw(needsReviewIds[0], batchId))}
                  >
                    Review next ({needsReviewIds.length} needs review)
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(counts).map(([status, count]) => (
                  <Badge key={status} variant={JOB_STATUS_TONE[status] ?? "secondary"}>
                    {JOB_STATUS_LABEL[status] ?? status}: {count}
                  </Badge>
                ))}
              </div>
              {Object.keys(qualityCounts).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Content quality:</span>
                  {Object.entries(qualityCounts).map(([status, count]) => (
                    <Badge key={status} variant={QUALITY_TONE[status] ?? "secondary"}>
                      {QUALITY_LABEL[status] ?? status}: {count}
                    </Badge>
                  ))}
                </div>
              )}
              {(data.interruptedCount ?? 0) > 0 && (
                <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                  {data.interruptedCount} file{data.interruptedCount === 1 ? "" : "s"} never completed — re-select
                  files to resume.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-1.5">
            {rows.map((row) => (
              <BatchJobRow key={row.id} row={row} batchId={batchId} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One file's row in Batch Detail — the action shown always matches the
 * job's REAL state (Section 7): a still-draft record gets "Review" (the
 * curator editing workflow), a published one gets "View" (the canonical
 * reader), a duplicate links to the record it collided with, and a
 * failure just shows why (there is nothing to click through to — the
 * original file was never uploaded for a failed/duplicate outcome, see
 * this pass's final report on original-file preservation limitations).
 */
function BatchJobRow({ row, batchId }: { row: ImportBatchJobRow; batchId: string }) {
  const navigate = useNavigate();
  const duplicateOfId = readDuplicateOfId(row.extracted_metadata);
  const display = batchJobDisplayStatus(row);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{row.displayName ?? row.filename}</p>
        {row.displayName && <p className="truncate text-xs text-muted-foreground">{row.filename}</p>}
        {row.duplicate_warning && (
          <p className="mt-0.5 max-w-xl text-xs text-amber-700 dark:text-amber-400">{row.duplicate_warning}</p>
        )}
        {row.error_summary && <p className="mt-0.5 max-w-xl text-xs text-destructive">{row.error_summary}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={display.tone}>{display.label}</Badge>
        {row.contentQualityStatus === "failed" && <Badge variant="destructive">Quality: Failed</Badge>}
        {row.target_case_law_id && row.reviewStatus === "published" && (
          <Button size="sm" variant="outline" onClick={() => navigate(ROUTES.caseLawDetail(row.target_case_law_id as string))}>
            View
          </Button>
        )}
        {row.target_case_law_id && row.reviewStatus !== "published" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(ROUTES.adminLegalLibraryReviewCaseLaw(row.target_case_law_id as string, batchId))}
          >
            Review
          </Button>
        )}
        {row.target_statute_id && row.reviewStatus === "published" && (
          <Button size="sm" variant="outline" onClick={() => navigate(ROUTES.legislationDetail(row.target_statute_id as string))}>
            View
          </Button>
        )}
        {row.target_statute_id && row.reviewStatus !== "published" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(ROUTES.adminLegalLibraryReviewStatute(row.target_statute_id as string, batchId))}
          >
            Review
          </Button>
        )}
        {row.status === "duplicate" && duplicateOfId && (
          <Button size="sm" variant="outline" onClick={() => navigate(ROUTES.caseLawDetail(duplicateOfId))}>
            View existing
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review Queue
// ---------------------------------------------------------------------------

/**
 * Review Queue scaling (Section 19/20): bulk ingestion can put hundreds of
 * drafts here, and one giant flat list of full editable cards does not
 * scale. Rather than a new query, a new schema, or a wholesale redesign
 * (Section 19: "make the smallest architectural/UI change required"),
 * this filters the SAME already-fetched rows client-side into named
 * buckets with counts — mirroring the example vocabulary from the spec
 * ("Needs Review (38), Ready to Publish (105), OCR Required (41), Failed
 * (3), Possible Duplicates (13)"). Opening a card for full editing is
 * unchanged.
 *
 * Bucket priority is deliberately a strict, mutually-exclusive ladder so
 * every row lands in exactly one tab (besides "All"): a failed extraction
 * is more actionable to know about than a duplicate warning, which is more
 * urgent than "just needs a Court/Jurisdiction pick." This ordering is a
 * triage convenience for the filter tabs only — it does not change what a
 * curator sees once a card is open (every relevant warning is still shown
 * there regardless of which bucket it landed in here).
 */
type ReviewCategory = "failed" | "ocr_required" | "possible_duplicate" | "ready_to_publish" | "needs_review";

const REVIEW_CATEGORY_LABEL: Record<ReviewCategory, string> = {
  needs_review: "Needs review",
  ready_to_publish: "Ready to publish",
  ocr_required: "OCR required",
  possible_duplicate: "Possible duplicates",
  failed: "Failed",
};

const REVIEW_CATEGORY_ORDER: ReviewCategory[] = [
  "needs_review",
  "ready_to_publish",
  "ocr_required",
  "possible_duplicate",
  "failed",
];

function categorizeCaseLawRow(row: ReviewRow<CaseLaw>): ReviewCategory {
  const envelope = readExtractionEnvelope(row.extracted_metadata);
  if (row.job_error_summary || envelope?.status === "failed") return "failed";
  if (envelope?.status === "requires_ocr") return "ocr_required";
  if (envelope?.ocrUsed) return "needs_review";
  // Genuinely-usable-but-below-threshold text must never look
  // "ready_to_publish" just because the placeholder-metadata checks
  // happen to pass — a curator has to look at it first.
  if (envelope?.status === "low_quality") return "needs_review";
  if (row.duplicate_warning) return "possible_duplicate";
  const errors = validateCaseLawForPublish({
    case_name: row.case_name,
    citation: row.citation,
    court: row.court,
    jurisdiction: row.jurisdiction,
    court_id: row.court_id,
    jurisdiction_id: row.jurisdiction_id,
    content_quality_status: row.content_quality_status,
  });
  return errors.length === 0 ? "ready_to_publish" : "needs_review";
}

function categorizeStatuteRow(row: ReviewRow<Statute>): ReviewCategory {
  const envelope = readExtractionEnvelope(row.extracted_metadata);
  if (row.job_error_summary || envelope?.status === "failed") return "failed";
  if (envelope?.status === "requires_ocr") return "ocr_required";
  if (envelope?.ocrUsed) return "needs_review";
  if (envelope?.status === "low_quality") return "needs_review";
  if (row.duplicate_warning) return "possible_duplicate";
  const errors = validateLegislationForPublish({
    code: row.code,
    title: row.title,
    content_quality_status: row.content_quality_status,
    jurisdiction: row.jurisdiction,
    jurisdiction_id: row.jurisdiction_id,
  });
  return errors.length === 0 ? "ready_to_publish" : "needs_review";
}

/**
 * Section 20: "Do not render hundreds of enormous editable forms
 * simultaneously." The filter tabs (Section 19) already triage a large
 * queue into smaller buckets, but even one bucket — or "All" — could
 * still be large once bulk ingestion is used at real scale. Rather than a
 * bigger redesign (pagination controls, virtualization, a compact-row +
 * detail-drawer split), the smallest change that actually bounds DOM size
 * is a simple reveal cap: render the first N full cards, offer "Show N
 * more" for the rest. Cheap, restrained, and easy to remove later if a
 * proper paginated query becomes worth the complexity.
 */
const REVIEW_PAGE_SIZE = 20;

function ReviewQueueTab({
  highlightCaseLawId,
  fromBatchId,
}: {
  highlightCaseLawId?: string | null;
  /** The batch this deep link came from (Section 12), if any — passed through to CaseLawReviewCard so it can offer "Back to batch" instead of only "Review Queue" as the only way out. */
  fromBatchId?: string | null;
}) {
  const { data: caseLawQueue, isPending: caseLawPending } = useCaseLawReviewQueue();
  const { data: statuteQueue, isPending: statutePending } = useLegislationReviewQueue();
  // Defaults to "All" (Section 10/11: a deep-linked "Review" target from
  // bulk results/Batch Detail must never be hidden behind a filter tab
  // that happens to exclude it — "All" guarantees it's always visible).
  const [activeCategory, setActiveCategory] = useState<ReviewCategory | "all">("all");
  const [sortMode, setSortMode] = useState<"newest" | "quality">("newest");
  const [caseLawVisible, setCaseLawVisible] = useState(REVIEW_PAGE_SIZE);
  const [statuteVisible, setStatuteVisible] = useState(REVIEW_PAGE_SIZE);
  // Switching filters starts back at the cap — otherwise "Show more" state
  // from a previous, unrelated filter would carry over confusingly.
  useEffect(() => {
    setCaseLawVisible(REVIEW_PAGE_SIZE);
    setStatuteVisible(REVIEW_PAGE_SIZE);
  }, [activeCategory]);

  const caseLawCategorized = (caseLawQueue ?? []).map((row) => ({ row, category: categorizeCaseLawRow(row) }));
  const statuteCategorized = (statuteQueue ?? []).map((row) => ({ row, category: categorizeStatuteRow(row) }));

  const counts: Record<ReviewCategory, number> = {
    needs_review: 0,
    ready_to_publish: 0,
    ocr_required: 0,
    possible_duplicate: 0,
    failed: 0,
  };
  for (const { category } of caseLawCategorized) counts[category] += 1;
  for (const { category } of statuteCategorized) counts[category] += 1;
  const totalCount = caseLawCategorized.length + statuteCategorized.length;

  const qualityScoreOf = (row: ReviewRow<CaseLaw> | ReviewRow<Statute>) =>
    readExtractionEnvelope(row.extracted_metadata)?.qualityScore ?? 1;
  const bySortMode = <T extends { row: ReviewRow<CaseLaw> | ReviewRow<Statute> }>(items: T[]): T[] => {
    if (sortMode !== "quality") return items;
    // Stable sort: lowest quality score first, so the items most likely to
    // need a curator's attention surface at the top of a large queue
    // instead of being buried on page 10 of a 20-per-page reveal cap.
    return [...items].sort((a, b) => qualityScoreOf(a.row) - qualityScoreOf(b.row));
  };

  const filteredCaseLawAll = bySortMode(
    activeCategory === "all" ? caseLawCategorized : caseLawCategorized.filter((c) => c.category === activeCategory),
  );
  const filteredStatuteAll = bySortMode(
    activeCategory === "all" ? statuteCategorized : statuteCategorized.filter((c) => c.category === activeCategory),
  );

  // A deep-linked highlight target must stay visible even if it would
  // otherwise fall past the reveal cap — never hide the one record the
  // curator was specifically sent here to review.
  const highlightIndex = highlightCaseLawId
    ? filteredCaseLawAll.findIndex((c) => c.row.id === highlightCaseLawId)
    : -1;
  const effectiveCaseLawVisible =
    highlightIndex >= 0 ? Math.max(caseLawVisible, highlightIndex + 1) : caseLawVisible;

  const filteredCaseLaw = filteredCaseLawAll.slice(0, effectiveCaseLawVisible);
  const filteredStatute = filteredStatuteAll.slice(0, statuteVisible);

  const activeLabel = activeCategory === "all" ? null : REVIEW_CATEGORY_LABEL[activeCategory].toLowerCase();

  return (
    <div className="space-y-6">
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                activeCategory === "all"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              All ({totalCount})
            </button>
            {REVIEW_CATEGORY_ORDER.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                disabled={counts[cat] === 0}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeCategory === cat
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {REVIEW_CATEGORY_LABEL[cat]} ({counts[cat]})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Sort:</span>
            <button
              type="button"
              onClick={() => setSortMode("newest")}
              className={`rounded-full border px-2 py-0.5 transition-colors ${
                sortMode === "newest" ? "border-primary text-primary" : "border-border hover:bg-muted"
              }`}
            >
              Newest first
            </button>
            <button
              type="button"
              onClick={() => setSortMode("quality")}
              className={`rounded-full border px-2 py-0.5 transition-colors ${
                sortMode === "quality" ? "border-primary text-primary" : "border-border hover:bg-muted"
              }`}
            >
              Lowest quality first
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-medium text-foreground">Case Law</h2>
        {caseLawPending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : filteredCaseLawAll.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {activeLabel ? `No Case Law drafts in "${activeLabel}".` : "No Case Law drafts awaiting review."}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {filteredCaseLaw.map(({ row }) => (
              <CaseLawReviewCard
                key={row.id}
                row={row}
                highlight={row.id === highlightCaseLawId}
                fromBatchId={fromBatchId}
              />
            ))}
            {filteredCaseLawAll.length > effectiveCaseLawVisible && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCaseLawVisible((n) => n + REVIEW_PAGE_SIZE)}
              >
                Show {Math.min(REVIEW_PAGE_SIZE, filteredCaseLawAll.length - effectiveCaseLawVisible)} more (
                {filteredCaseLawAll.length - effectiveCaseLawVisible} remaining)
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-medium text-foreground">Legislation</h2>
        {statutePending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : filteredStatuteAll.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {activeLabel ? `No Legislation drafts in "${activeLabel}".` : "No Legislation drafts awaiting review."}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {filteredStatute.map(({ row }) => (
              <StatuteReviewCard key={row.id} row={row} />
            ))}
            {filteredStatuteAll.length > statuteVisible && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStatuteVisible((n) => n + REVIEW_PAGE_SIZE)}
              >
                Show {Math.min(REVIEW_PAGE_SIZE, filteredStatuteAll.length - statuteVisible)} more (
                {filteredStatuteAll.length - statuteVisible} remaining)
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CaseLawReviewCard({
  row,
  highlight = false,
  fromBatchId = null,
}: {
  row: ReviewRow<CaseLaw>;
  highlight?: boolean;
  /** Batch this card was reached from (Section 12) — renders "Back to batch" alongside "View full record" when set, so a curator who arrived via Batch Detail isn't left with only the full, unfiltered Review Queue to return to. */
  fromBatchId?: string | null;
}) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  // Deep-link target from bulk results/Batch Detail (Section 10/11) —
  // scrolled into view and briefly outlined once, on arrival, so the
  // curator lands on the exact record rather than the top of a
  // potentially long Review Queue list.
  useEffect(() => {
    if (highlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);
  const update = useUpdateCanonicalCaseLaw(row.id);
  const setStatus = useSetCaseLawReviewStatus();
  const reject = useRejectCanonicalCaseLaw();
  const reprocess = useReprocessCaseLawExtraction();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const { data: appliedTags } = useCaseLawTags(row.id);
  const applyTags = useApplyCaseLawTags(row.id);
  const [fields, setFields] = useState({
    case_name: row.case_name,
    citation: row.citation,
    decided_date: row.decided_date ?? "",
    court_id: row.court_id,
    jurisdiction_id: row.jurisdiction_id,
    // Section 4F/14: previously nowhere in the app could a curator fix a
    // low-quality/missing extraction before publishing — the canonical
    // detail page can't edit a canonical row at all (owner_id IS NULL),
    // and this card didn't expose these two fields either, so "No
    // summary or full text on record" had no path to resolution short of
    // direct database access. useUpdateCanonicalCaseLaw already accepts
    // any case_law column (it's `Partial<CanonicalCaseLawInput>`) — this
    // was a UI gap, not a data-layer one.
    summary: row.summary ?? "",
    full_text: row.full_text ?? "",
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const [reprocessNote, setReprocessNote] = useState<string | null>(null);
  const fullTextRef = useRef<HTMLTextAreaElement>(null);
  const reviewEnvelope = readExtractionEnvelope(row.extracted_metadata);
  const needsPaste = reviewEnvelope?.status === "requires_ocr" || reviewEnvelope?.status === "failed";
  useEffect(() => {
    if (needsPaste) fullTextRef.current?.focus();
  }, [needsPaste, row.id]);
  const dirty =
    fields.case_name !== row.case_name ||
    fields.citation !== row.citation ||
    fields.decided_date !== (row.decided_date ?? "") ||
    fields.court_id !== row.court_id ||
    fields.jurisdiction_id !== row.jurisdiction_id ||
    fields.summary !== (row.summary ?? "") ||
    fields.full_text !== (row.full_text ?? "");

  // Save-state reflects the mutation's own pending/success/error status —
  // never local "the user typed something" guessing (§17). Resets to
  // "idle" the moment a further edit is made so a stale "Saved" doesn't
  // linger over an un-persisted change.
  const saveState: SaveState = dirty
    ? "idle"
    : update.status === "pending"
      ? "saving"
      : update.status === "success"
        ? "saved"
        : update.status === "error"
          ? "error"
          : "idle";

  /** Selecting a canonical Court auto-populates Jurisdiction where the court has one on file (§3/§4) — regional/supranational courts (CCJ, JCPC) carry no fixed jurisdiction_id and are left for the curator to set explicitly. Takes the full court object (not just an id) so a just-created Court works identically to an existing one — see CourtField/AddCourtDialog. */
  function handleCourtChange(court: LegalAuthorityCourt | null) {
    setFields((f) => ({
      ...f,
      court_id: court?.id ?? null,
      jurisdiction_id: court?.jurisdiction_id ?? f.jurisdiction_id,
    }));
  }

  function handleSave() {
    // Legacy free-text court/jurisdiction columns are never edited
    // directly in this card — they're derived automatically from the
    // canonical selection whenever it changes, so the NOT NULL legacy
    // columns stay populated without the curator ever typing the same
    // Court/Jurisdiction twice (§2/§3/§19).
    const court = (courts ?? []).find((c) => c.id === fields.court_id)?.canonical_name ?? row.court;
    const jurisdiction =
      (jurisdictions ?? []).find((j) => j.id === fields.jurisdiction_id)?.name ?? row.jurisdiction;
    update.mutate({
      case_name: fields.case_name,
      citation: fields.citation,
      decided_date: fields.decided_date || null,
      court_id: fields.court_id,
      jurisdiction_id: fields.jurisdiction_id,
      court,
      jurisdiction,
      summary: fields.summary || null,
      full_text: fields.full_text || null,
    });
  }

  function handleReprocess(maxOcrPages?: number) {
    if (!row.uploaded_document_id) return;
    setReprocessNote(null);
    reprocess.mutate(
      {
        caseLawId: row.id,
        importJobId: row.import_job_id,
        uploadedDocumentId: row.uploaded_document_id,
        originalFilename: row.original_filename,
        current: {
          case_name: fields.case_name,
          citation: fields.citation,
          court_id: fields.court_id,
          jurisdiction_id: fields.jurisdiction_id,
          decided_date: fields.decided_date,
          full_text: fields.full_text,
        },
        extractedMetadata: row.extracted_metadata,
        courts: courts ?? [],
        jurisdictions: jurisdictions ?? [],
        maxOcrPages,
        onProgress: (page, total) => setReprocessNote(`Recognizing page ${page} of ${total}`),
      },
      {
        onSuccess: (result) => {
          setReprocessNote(null);
          setFields((f) => ({
            ...f,
            case_name: result.merged.case_name,
            citation: result.merged.citation,
            court_id: result.merged.court_id,
            jurisdiction_id: result.merged.jurisdiction_id,
            decided_date: result.merged.decided_date,
            full_text: result.merged.full_text,
          }));
        },
        onSettled: () => setReprocessNote(null),
      },
    );
  }

  const selectedCourt = (courts ?? []).find((c) => c.id === fields.court_id) ?? null;
  const validationErrors = validateCaseLawForPublish({
    case_name: fields.case_name,
    citation: fields.citation,
    court: (courts ?? []).find((c) => c.id === fields.court_id)?.canonical_name ?? row.court,
    jurisdiction: (jurisdictions ?? []).find((j) => j.id === fields.jurisdiction_id)?.name ?? row.jurisdiction,
    court_id: fields.court_id,
    jurisdiction_id: fields.jurisdiction_id,
    content_quality_status: row.content_quality_status,
  });
  const canPublish = validationErrors.length === 0 && !dirty;

  const sourceName = row.source_id
    ? (sources ?? []).find((s) => s.id === row.source_id)?.name ?? "Unknown source"
    : null;
  const appliedTagNames = (appliedTags ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((n): n is string => !!n);

  return (
    <Card ref={cardRef} className={highlight ? "ring-2 ring-primary transition-shadow" : undefined}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{row.case_name}</CardTitle>
            <Badge variant="outline">Case Law</Badge>
            {row.job_status && <Badge variant="secondary">{JOB_STATUS_LABEL[row.job_status] ?? row.job_status}</Badge>}
            {isPlaceholderValue(row.case_name) && (
              <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                Case name requires review
              </Badge>
            )}
          </div>
          <CardDescription>
            {row.review_status === "needs_review" ? "Needs review" : "Draft"} · Created{" "}
            {formatDate(row.created_at)}
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          {fromBatchId && (
            <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.adminLegalLibraryBatch(fromBatchId))}>
              <ArrowLeft className="h-4 w-4" />
              Back to batch
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.caseLawDetail(row.id))}>
            View full record
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {row.duplicate_warning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{row.duplicate_warning}</span>
          </div>
        )}

        {/* METADATA */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Case name" required>
            <Input
              value={fields.case_name}
              onChange={(e) => setFields((f) => ({ ...f, case_name: e.target.value }))}
            />
          </Field>
          <Field label="Citation" required>
            <Input
              value={fields.citation}
              onChange={(e) => setFields((f) => ({ ...f, citation: e.target.value }))}
            />
          </Field>
          <Field label="Decision date">
            <DateOnlyInput
              value={fields.decided_date}
              onChange={(v) => setFields((f) => ({ ...f, decided_date: v }))}
            />
          </Field>
          <div />
          <JurisdictionField
            value={fields.jurisdiction_id}
            onChange={(id) => setFields((f) => ({ ...f, jurisdiction_id: id }))}
            jurisdictions={jurisdictions ?? []}
            hint={
              selectedCourt?.jurisdiction_id
                ? "Auto-set from the selected Court."
                : selectedCourt
                  ? "This court spans multiple jurisdictions — set explicitly."
                  : undefined
            }
          />
          <CourtField value={fields.court_id} onChange={handleCourtChange} courts={courts ?? []} />
        </div>

        {/* TEXT — editable here specifically because nowhere else in the
            app can a curator fix this before publishing: the canonical
            reader (case-law detail page) can never edit a canonical row,
            and OCR/low-quality extraction can leave this genuinely empty
            at ingest time (Section 14/4F — "No summary or full text on
            record" previously had no path to resolution short of direct
            database access). */}
        <details className="rounded-md border border-border p-2.5 text-sm" open={needsPaste || undefined}>
          <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
            Summary and full text
            {!fields.summary && !fields.full_text && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">— none on record yet</span>
            )}
            {needsPaste && (
              <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
                — paste the judgment text here
              </span>
            )}
          </summary>
          <div className="mt-3 space-y-3">
            <Field label="Summary" hint="Optional — a short curator-written synopsis, distinct from the full text below.">
              <Textarea
                value={fields.summary}
                onChange={(e) => setFields((f) => ({ ...f, summary: e.target.value }))}
                rows={2}
              />
            </Field>
            <Field
              label="Full text"
              hint="What machine extraction captured, if any — paste or correct it here (e.g. after OCR required/low-quality extraction, or copying from the original file)."
            >
              <Textarea
                ref={fullTextRef}
                value={fields.full_text}
                onChange={(e) => setFields((f) => ({ ...f, full_text: e.target.value }))}
                rows={6}
              />
            </Field>
          </div>
        </details>

        {/* CLASSIFICATION */}
        <TagReviewEditor
          proposed={row.proposed_tags}
          proposals={readTagProposals(row.extracted_metadata, row.proposed_tags)}
          applied={appliedTagNames}
          isSaving={applyTags.isPending}
          onSave={(names) => applyTags.mutate(names)}
        />

        {/* EXTRACTION — what the machine determined and how confident it is (Phase 9) */}
        <ExtractionStatusPanel
          envelope={readExtractionEnvelope(row.extracted_metadata)}
          caseNameConfidence={readCaseNameConfidence(row.extracted_metadata)}
          caseNameSource={readCaseNameSource(row.extracted_metadata)}
        />
        {row.job_error_summary && (
          <p className="text-xs text-destructive">Import job error: {row.job_error_summary}</p>
        )}

        {/* PROVENANCE */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>Source repository: {sourceName ?? "unassigned"}</span>
          {row.source_url && (
            <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="underline">
              Source URL
            </a>
          )}
          <OriginalDocumentLink documentId={row.uploaded_document_id} />
        </div>

        {/* ACTIONS */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {row.uploaded_document_id && (
            <div className="mr-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={reprocess.isPending}
                onClick={() => handleReprocess()}
              >
                <RefreshCw className={`h-4 w-4 ${reprocess.isPending ? "animate-spin" : ""}`} />
                Re-run extraction
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={reprocess.isPending}
                onClick={() => handleReprocess(OCR_METADATA_PAGES)}
              >
                OCR first {OCR_METADATA_PAGES} pages
              </Button>
              {(reprocess.isPending || reprocessNote) && (
                <span className="text-[11px] text-muted-foreground">
                  {reprocessNote ?? "Re-running extraction from the stored original…"}
                </span>
              )}
            </div>
          )}
          <SaveIndicator state={saveState} onRetry={handleSave} />
          {dirty && (
            <Button size="sm" variant="outline" disabled={update.isPending} onClick={handleSave}>
              Save changes
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
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={!canPublish || setStatus.isPending}
              onClick={() => setStatus.mutate({ id: row.id, review_status: "published" })}
            >
              <CheckCircle2 className="h-4 w-4" />
              Publish
            </Button>
            {validationErrors.length > 0 && (
              <p className="max-w-xs text-right text-[11px] text-destructive">
                Cannot publish: {validationErrors.join(" ")}
              </p>
            )}
            {validationErrors.length === 0 && dirty && (
              <p className="text-[11px] text-muted-foreground">Save changes before publishing.</p>
            )}
          </div>
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
  const reassess = useReassessStatuteExtraction();
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
    short_title: row.short_title ?? "",
    act_number: row.act_number ?? "",
    enactment_year: row.enactment_year ? String(row.enactment_year) : "",
    instrument_type: row.instrument_type ?? "",
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [fullTextDraft, setFullTextDraft] = useState(row.full_text ?? "");
  const dirty =
    fields.title !== row.title ||
    fields.code !== row.code ||
    fields.jurisdiction !== row.jurisdiction ||
    fields.chapter_number !== (row.chapter_number ?? "") ||
    fields.jurisdiction_id !== row.jurisdiction_id ||
    fields.short_title !== (row.short_title ?? "") ||
    fields.act_number !== (row.act_number ?? "") ||
    fields.enactment_year !== (row.enactment_year ? String(row.enactment_year) : "") ||
    fields.instrument_type !== (row.instrument_type ?? "");
  const fullTextDirty = fullTextDraft !== (row.full_text ?? "");

  const sourceName = row.source_id
    ? (sources ?? []).find((s) => s.id === row.source_id)?.name ?? "Unknown source"
    : null;
  const appliedTagNames = (appliedTags ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((n): n is string => !!n);
  // Same "tiny shared fix" placeholder-metadata gate as Case Law (§6/§15)
  // — checked against the currently SAVED row, not the in-progress edit
  // buffer, since Publish is also disabled while `dirty` is true.
  const statuteValidationErrors = validateLegislationForPublish({
    code: row.code,
    title: row.title,
    jurisdiction: row.jurisdiction,
    jurisdiction_id: row.jurisdiction_id,
    content_quality_status: row.content_quality_status,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{row.title}</CardTitle>
            <Badge variant="outline">Legislation</Badge>
            {row.job_status && <Badge variant="secondary">{JOB_STATUS_LABEL[row.job_status] ?? row.job_status}</Badge>}
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

        <ExtractionStatusPanel envelope={readExtractionEnvelope(row.extracted_metadata)} />
        {row.job_error_summary && (
          <p className="text-xs text-destructive">Import job error: {row.job_error_summary}</p>
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
          <JurisdictionField
            value={fields.jurisdiction_id}
            onChange={(id) => setFields((f) => ({ ...f, jurisdiction_id: id }))}
            jurisdictions={jurisdictions ?? []}
          />
          <Input
            value={fields.short_title}
            onChange={(e) => setFields((f) => ({ ...f, short_title: e.target.value }))}
            placeholder="Short title"
          />
          <Input
            value={fields.act_number}
            onChange={(e) => setFields((f) => ({ ...f, act_number: e.target.value }))}
            placeholder="Act number (e.g. 13 of 2025)"
          />
          <Input
            value={fields.enactment_year}
            onChange={(e) => setFields((f) => ({ ...f, enactment_year: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
            placeholder="Enactment year"
            inputMode="numeric"
          />
          <Input
            value={fields.instrument_type}
            onChange={(e) => setFields((f) => ({ ...f, instrument_type: e.target.value }))}
            placeholder="Instrument type (Act / Ordinance / Regulations)"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowFullText((v) => !v)}>
              {showFullText ? "Hide full text" : "Show / edit full text"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reassess.isPending}
              onClick={() =>
                reassess.mutate({
                  statuteId: row.id,
                  importJobId: row.import_job_id,
                  fullText: fullTextDraft,
                  extractedMetadata: row.extracted_metadata,
                  current: {
                    short_title: row.short_title,
                    act_number: row.act_number,
                    enactment_year: row.enactment_year,
                    instrument_type: row.instrument_type,
                    chapter_number: row.chapter_number,
                  },
                })
              }
            >
              Re-check extraction quality
            </Button>
          </div>
          {showFullText && (
            <textarea
              className="min-h-40 w-full rounded-md border border-border bg-background p-2 text-xs"
              value={fullTextDraft}
              onChange={(e) => setFullTextDraft(e.target.value)}
              placeholder="Full text — paste the corrected/complete document text here, then Re-check extraction quality."
            />
          )}
          {fullTextDirty && (
            <p className="text-[11px] text-muted-foreground">
              Full text changed — click "Re-check extraction quality" to assess and save it.
            </p>
          )}
        </div>

        <TagReviewEditor
          proposed={row.proposed_tags}
          proposals={readTagProposals(row.extracted_metadata, row.proposed_tags)}
          applied={appliedTagNames}
          isSaving={applyTags.isPending}
          onSave={(names) => applyTags.mutate(names)}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  title: fields.title,
                  code: fields.code,
                  jurisdiction: fields.jurisdiction,
                  jurisdiction_id: fields.jurisdiction_id,
                  chapter_number: fields.chapter_number || null,
                  short_title: fields.short_title || null,
                  act_number: fields.act_number || null,
                  enactment_year: fields.enactment_year ? Number(fields.enactment_year) : null,
                  instrument_type: fields.instrument_type || null,
                })
              }
            >
              Save changes
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
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={statuteValidationErrors.length > 0 || dirty || fullTextDirty || setStatus.isPending}
              onClick={() => setStatus.mutate({ id: row.id, review_status: "published" })}
            >
              <CheckCircle2 className="h-4 w-4" />
              Publish
            </Button>
            {statuteValidationErrors.length > 0 && (
              <p className="max-w-xs text-right text-[11px] text-destructive">
                Cannot publish: {statuteValidationErrors.join(" ")}
              </p>
            )}
          </div>
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
