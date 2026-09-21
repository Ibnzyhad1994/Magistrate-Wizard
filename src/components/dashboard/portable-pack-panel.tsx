import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DetailsHint } from "@/components/common/details-hint";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { matterIsExportable, type MatterPackManifest } from "@/lib/matter-pack";
import {
  buildMatterPack,
  downloadBlob,
  importMatterPack,
  readMatterPackFile,
} from "@/lib/matter-pack-io";
import { getErrorMessage } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { docketMattersKeys } from "@/hooks/docket/use-docket-matters";

type PackCandidate = {
  id: string;
  court_id: string;
  case_number: string;
  matter_title: string;
};

export function PortablePackPanel({
  candidates,
  sittingCourts,
  retainedMatterIds,
  existingCaseNumbers,
  isPending = false,
}: {
  candidates: PackCandidate[];
  sittingCourts: Array<{ court_id: string; court_name: string; district_id: string | null }>;
  retainedMatterIds: string[];
  existingCaseNumbers: Array<{ case_number: string; court_id: string }>;
  isPending?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [includeFiles, setIncludeFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<MatterPackManifest | null>(null);
  const [courtId, setCourtId] = useState(sittingCourts[0]?.court_id ?? "");

  const exportable = useMemo(
    () =>
      candidates.filter((row) =>
        matterIsExportable({
          matterId: row.id,
          courtId: row.court_id,
          sittingCourtIds: sittingCourts.map((court) => court.court_id),
          retainedMatterIds,
        }),
      ),
    [candidates, sittingCourts, retainedMatterIds],
  );

  const selectedCourt = sittingCourts.find((court) => court.court_id === courtId);

  useEffect(() => {
    if (!courtId && sittingCourts[0]) setCourtId(sittingCourts[0].court_id);
  }, [courtId, sittingCourts]);
  const handleToggle = (id: string, checked: boolean) => {
    setSelected((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const blob = await buildMatterPack({
        matterIds: selected,
        sittingCourtIds: sittingCourts.map((court) => court.court_id),
        retainedMatterIds,
        includeFiles,
      });
      downloadBlob(blob, `matter-pack-${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success("Pack downloaded.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const pack = await readMatterPackFile(file);
      setPreview(pack);
    } catch (error) {
      setPreview(null);
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    if (!selectedCourt?.district_id) {
      toast.error("Choose a court you currently sit. That court must have a district.");
      return;
    }
    setBusy(true);
    try {
      const result = await importMatterPack({
        pack: preview,
        courtId: selectedCourt.court_id,
        districtId: selectedCourt.district_id,
        existing: existingCaseNumbers,
      });
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
      toast.success(
        result.skipped > 0
          ? `Brought on ${result.created} file${result.created === 1 ? "" : "s"}. Skipped ${result.skipped} already on that court.`
          : `Brought on ${result.created} file${result.created === 1 ? "" : "s"}.`,
      );
      setPreview(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Dispatch</CardTitle>
            <CardDescription className="mt-1.5 max-w-2xl">
              Take a file with you, or bring one in. A pack is a copy, not the live docket. Shares
              and other people&apos;s notes stay here.
            </CardDescription>
          </div>
          <DetailsHint
            label="What a matter pack contains"
            details="You can export files from a court you sit, or ones retained to you. A view share isn't enough. The zip has the file details, parties (no contact details) and hearings. Stages aren't filled in on import, so log them on the board yourself."
          />
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p className="text-sm text-muted-foreground">Reading the files you can pack…</p>
        ) : (
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">Take off this platform</h3>
              {exportable.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No files you sit or retain are on the board in view.
                </p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto border-y border-border py-3">
                  {exportable.map((row) => {
                    const checked = selected.includes(row.id);
                    return (
                      <li key={row.id} className="flex items-start gap-2">
                        <Checkbox
                          id={`pack-${row.id}`}
                          checked={checked}
                          onCheckedChange={(value) => handleToggle(row.id, value)}
                          aria-label={`Include ${row.case_number}`}
                        />
                        <Label
                          htmlFor={`pack-${row.id}`}
                          className="text-sm font-normal leading-snug"
                        >
                          <span className="font-medium">{row.case_number}</span>
                          <span className="block text-muted-foreground">{row.matter_title}</span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={includeFiles}
                  onCheckedChange={setIncludeFiles}
                  aria-label="List document names in the pack"
                />
                <span>
                  List document names
                  <span className="block text-xs text-muted-foreground">
                    Originals stay on the file. This only writes an index, not the PDFs.
                  </span>
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy || selected.length === 0}
                onClick={() => void handleExport()}
              >
                {busy ? "Preparing…" : "Download pack"}
              </Button>
            </div>

            <div className="space-y-4 lg:border-l lg:border-border lg:pl-12">
              <h3 className="text-sm font-medium text-foreground">Bring onto this platform</h3>
              <input
                type="file"
                accept=".zip,.json,application/json,application/zip"
                aria-label="Choose a matter pack to review"
                className="block w-full text-sm file:mr-3 file:rounded-sm file:border file:border-border file:bg-secondary file:px-3 file:py-1.5"
                onChange={(event) => void handlePickFile(event.target.files?.[0])}
              />
              {preview && (
                <div className="space-y-3 border border-border p-3">
                  <p className="text-sm text-foreground">
                    {preview.matters.length} file{preview.matters.length === 1 ? "" : "s"} ready to
                    review. They will open on the court you choose, with you as the person who
                    brought them in.
                  </p>
                  <ul className="max-h-32 overflow-y-auto text-sm text-muted-foreground">
                    {preview.matters.map((matter) => (
                      <li key={matter.case_number}>
                        {matter.case_number} · {matter.matter_title}
                      </li>
                    ))}
                  </ul>
                  {sittingCourts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Sit a court before bringing a file onto the sheet.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <Label htmlFor="pack-court">Open on court</Label>
                      <Select
                        id="pack-court"
                        value={courtId}
                        onChange={(event) => setCourtId(event.target.value)}
                      >
                        {sittingCourts.map((court) => (
                          <option key={court.court_id} value={court.court_id}>
                            {court.court_name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || sittingCourts.length === 0}
                    onClick={() => void handleImport()}
                  >
                    {busy ? "Bringing on…" : "Confirm onto this court"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
