import { supabase } from "@/lib/supabase";
import {
  duplicateCaseNumbers,
  importJacketValues,
  matterIsExportable,
  parseMatterPack,
  sanitizeMatterForPack,
  MATTER_PACK_FORMAT,
  MATTER_PACK_VERSION,
  type MatterPackManifest,
  type MatterPackMatter,
} from "@/lib/matter-pack";
import type { TablesInsert } from "@/types/database.types";

export async function buildMatterPack(args: {
  matterIds: string[];
  sittingCourtIds: string[];
  retainedMatterIds: string[];
  includeFiles: boolean;
}): Promise<Blob> {
  if (args.matterIds.length === 0) {
    throw new Error("Choose at least one matter you sit or retain.");
  }

  const { data: matters, error: matterError } = await supabase
    .from("docket_matters")
    .select("*")
    .in("id", args.matterIds)
    .is("deleted_at", null);
  if (matterError) throw matterError;

  const authorized = (matters ?? []).filter((row) =>
    matterIsExportable({
      matterId: row.id,
      courtId: row.court_id,
      sittingCourtIds: args.sittingCourtIds,
      retainedMatterIds: args.retainedMatterIds,
    }),
  );
  if (authorized.length === 0) {
    throw new Error("None of those files are on a court you sit, or retained to you.");
  }

  const ids = authorized.map((row) => row.id);
  const [{ data: parties, error: partyError }, { data: events, error: eventError }] =
    await Promise.all([
      supabase.from("docket_matter_parties").select("*").in("docket_matter_id", ids),
      supabase.from("docket_events").select("*").in("docket_matter_id", ids),
    ]);
  if (partyError) throw partyError;
  if (eventError) throw eventError;

  let documentsIndex: Array<{ matter_id: string; file_name: string; purpose: string }> = [];
  if (args.includeFiles) {
    const { data: docs, error: docError } = await supabase
      .from("documents")
      .select("entity_id, file_name, purpose")
      .eq("entity_type", "docket_matter")
      .in("entity_id", ids);
    if (docError) throw docError;
    documentsIndex = (docs ?? []).flatMap((row) =>
      row.entity_id
        ? [{ matter_id: row.entity_id, file_name: row.file_name, purpose: row.purpose }]
        : [],
    );
  }

  const packed: MatterPackMatter[] = authorized.flatMap((row) => {
    const record: Record<string, unknown> = { ...row };
    record.parties = (parties ?? []).filter((party) => party.docket_matter_id === row.id);
    record.events = (events ?? []).filter((event) => event.docket_matter_id === row.id);
    const matter = sanitizeMatterForPack(record);
    return matter ? [matter] : [];
  });

  const manifest: MatterPackManifest = {
    format: MATTER_PACK_FORMAT,
    version: MATTER_PACK_VERSION,
    exported_at: new Date().toISOString(),
    include_files: args.includeFiles,
    matters: packed,
  };

  // JSZip is fetched when a pack is actually built or read, not on app load.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  packed.forEach((matter, index) => {
    const slug = matter.case_number.replace(/[^\w.-]+/g, "_");
    zip.file(
      `matters/${String(index + 1).padStart(2, "0")}-${slug}.json`,
      JSON.stringify(matter, null, 2),
    );
  });
  if (args.includeFiles) {
    zip.file(
      "documents/index.json",
      JSON.stringify(
        {
          note: "Original files stay on the docket. This index lists names the exporter could already see.",
          documents: documentsIndex,
        },
        null,
        2,
      ),
    );
  }
  return zip.generateAsync({ type: "blob" });
}

export async function readMatterPackFile(file: File): Promise<MatterPackManifest> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const parsed = parseMatterPack(JSON.parse(await file.text()));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.pack;
  }
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("That zip has no manifest.json.");
  const parsed = parseMatterPack(JSON.parse(await manifestFile.async("string")));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.pack;
}

export async function importMatterPack(args: {
  pack: MatterPackManifest;
  courtId: string;
  districtId: string;
  existing: Array<{ case_number: string; court_id: string }>;
}) {
  const dupes = new Set(
    duplicateCaseNumbers(args.pack.matters, args.existing, args.courtId).map((value) =>
      value.toLowerCase(),
    ),
  );
  let created = 0;
  let skipped = 0;
  for (const matter of args.pack.matters) {
    if (dupes.has(matter.case_number.toLowerCase())) {
      skipped += 1;
      continue;
    }
    const jacket = importJacketValues(matter, args.courtId, args.districtId);
    const { data, error } = await supabase
      .from("docket_matters")
      .insert(jacket as TablesInsert<"docket_matters">)
      .select("id")
      .single();
    if (error) throw error;
    if (matter.parties.length > 0) {
      const { error: partyError } = await supabase.from("docket_matter_parties").insert(
        matter.parties.map((party) => ({
          docket_matter_id: data.id,
          full_name: party.full_name,
          role: party.role,
          party_type: party.party_type ?? undefined,
          party_status: party.party_status,
          attorney_name: party.attorney_name,
        })),
      );
      if (partyError) throw partyError;
    }
    if (matter.events.length > 0) {
      const { error: eventError } = await supabase.from("docket_events").insert(
        matter.events.map((event) => ({
          docket_matter_id: data.id,
          event_type: event.event_type,
          scheduled_date: event.scheduled_date,
          scheduled_time: event.scheduled_time,
          location: event.location,
          event_status: event.event_status,
          stage_at_event: event.stage_at_event,
          outcome_at_event: event.outcome_at_event,
          orders_made_at_event: event.orders_made_at_event,
          notes: event.notes,
        })),
      );
      if (eventError) throw eventError;
    }
    created += 1;
  }
  return { created, skipped };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
