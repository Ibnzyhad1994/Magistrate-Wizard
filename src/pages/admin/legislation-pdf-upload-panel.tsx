import { useState } from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { Field, JurisdictionField } from "@/components/legal-library/taxonomy-fields";
import { useLegalJurisdictions } from "@/hooks/legal-library/use-legal-taxonomy";
import { useCreateLegislationDocument } from "@/hooks/legislation/use-legislation";
import { extractPdfjsTextContent } from "@/lib/ocr/rasterize-pdf";
import { classifyIngestSource } from "@/lib/ingest-source";
import { MIN_DOCUMENT_TEXT_CHARS } from "@/lib/legislation-pdf";
import { toast } from "sonner";

const PDF_ONLY_MESSAGE =
  "Legislation must be uploaded as a PDF so that its official formatting can be preserved.";

const EMPTY_FIELDS = {
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
};

export interface LegislationSupersedePrefill {
  id: string;
  code: string;
  title: string;
  short_title: string | null;
  jurisdiction_id: string | null;
  instrument_type: string | null;
  act_number: string | null;
  chapter_number: string | null;
  enactment_year: number | null;
  effective_date: string | null;
  summary: string | null;
}

/**
 * File-first Legislation upload (0098) -- replaces the old "extract text,
 * ingest, review" panel for Legislation only. The uploaded PDF is stored
 * unchanged and becomes the record's canonical viewing document; no text
 * extraction, chunking, or import_jobs row is ever created here. Reused
 * for both a brand-new Act (no `supersede`) and replacing an existing
 * Act's PDF with a new version (`supersede` pre-fills metadata and links
 * the new record back via supersedes_statute_id -- see
 * finalize_legislation_document, 0098).
 */
export function LegislationPdfUploadPanel({
  supersede,
  onSuccess,
}: {
  supersede?: LegislationSupersedePrefill;
  onSuccess: (statuteId: string) => void;
}) {
  const { data: jurisdictions } = useLegalJurisdictions();
  const createDocument = useCreateLegislationDocument();

  const [fields, setFields] = useState(() =>
    supersede
      ? {
          code: supersede.code,
          title: supersede.title,
          short_title: supersede.short_title ?? "",
          jurisdiction_id: supersede.jurisdiction_id ?? "",
          instrument_type: supersede.instrument_type ?? "",
          act_number: supersede.act_number ?? "",
          chapter_number: supersede.chapter_number ?? "",
          enactment_year: supersede.enactment_year != null ? String(supersede.enactment_year) : "",
          effective_date: supersede.effective_date ?? "",
          summary: supersede.summary ?? "",
        }
      : EMPTY_FIELDS,
  );
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [hasTextLayer, setHasTextLayer] = useState<boolean | null>(null);

  function setField<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function handleFile(f: File) {
    if (classifyIngestSource(f) !== "pdf") {
      toast.error(PDF_ONLY_MESSAGE);
      return;
    }
    setFile(f);
    setPageCount(null);
    setHasTextLayer(null);
    setAnalyzing(true);
    try {
      const result = await extractPdfjsTextContent(f);
      if (result.ok) {
        setPageCount(result.pageCount);
        const totalChars = result.pages.reduce((sum, p) => sum + p.characterCount, 0);
        setHasTextLayer(totalChars >= MIN_DOCUMENT_TEXT_CHARS);
      } else {
        // Could not even open the PDF to inspect it -- still allow the
        // upload (the file itself may be fine; the viewer will surface a
        // clearer error if it's genuinely corrupt), just without page
        // count/text-layer hints.
        setPageCount(null);
        setHasTextLayer(null);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  const jurisdictionName = (jurisdictions ?? []).find((j) => j.id === fields.jurisdiction_id)?.name ?? "";
  const canSubmit =
    fields.code.trim() && fields.title.trim() && fields.jurisdiction_id && file && !analyzing;

  function handleSubmit() {
    if (!file) return;
    createDocument.mutate(
      {
        values: {
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
          supersedes_statute_id: supersede?.id ?? null,
        },
        file,
        pageCount,
        hasTextLayer,
      },
      { onSuccess: (statuteId) => onSuccess(statuteId) },
    );
  }

  return (
    <div className="space-y-4">
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
          onChange={(id) => setField("jurisdiction_id", id ?? "")}
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
          <Input
            type="number"
            value={fields.enactment_year}
            onChange={(e) => setField("enactment_year", e.target.value)}
          />
        </Field>
        <Field label="Effective date">
          <DateOnlyInput value={fields.effective_date} onChange={(v) => setField("effective_date", v)} />
        </Field>
      </div>

      <Field label="Description or administrative note (optional)">
        <Textarea value={fields.summary} onChange={(e) => setField("summary", e.target.value)} rows={3} />
      </Field>

      <div className="space-y-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          <Upload className="h-4 w-4" />
          {file ? "Change PDF" : "Upload PDF"}
          <input
            type="file"
            className="hidden"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
        {file && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            {file.name}
            {analyzing
              ? ": checking page count…"
              : pageCount != null
                ? `: ${pageCount} page${pageCount === 1 ? "" : "s"}${hasTextLayer === false ? ", no searchable text detected (scanned)" : ""}`
                : ""}
          </p>
        )}
        {!file && (
          <p className="text-xs text-muted-foreground">{PDF_ONLY_MESSAGE}</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button disabled={!canSubmit || createDocument.isPending} onClick={handleSubmit}>
          {createDocument.isPending && <LoadingSpinner className="text-current" size={16} />}
          {supersede ? "Publish replacement" : "Upload and publish"}
        </Button>
      </div>
    </div>
  );
}
