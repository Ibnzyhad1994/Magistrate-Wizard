import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Bookmark } from "@/types/database.types";

export interface BookmarkLabel {
  label: string;
  subtitle: string | null;
  /** Set for entity types whose route needs a second id (e.g. statute_provision needs its parent statute id to build /legislation/:statuteId/section/:provisionId). */
  parentId?: string;
}

/**
 * Resolves display labels for a page of Bookmarks in ONE batched query per
 * entity type (`.in("id", ids)`), never one query per bookmark row — avoids
 * an N+1 fan-out on the Bookmarks list regardless of how many rows it has.
 * A missing entry in the returned map means the target is gone or the
 * caller has since lost access — the bookmark row itself is still kept and
 * shown, just with "Unavailable" in place of a resolved label.
 */
export function useBookmarkLabels(bookmarks: Bookmark[] | undefined) {
  const ids = (type: Bookmark["entity_type"]) =>
    (bookmarks ?? []).filter((b) => b.entity_type === type).map((b) => b.entity_id);

  return useQuery({
    queryKey: ["bookmark-labels", (bookmarks ?? []).map((b) => b.id).sort().join(",")],
    queryFn: async () => {
      const map = new Map<string, BookmarkLabel>();

      const docketMatterIds = ids("docket_matter");
      const judgmentIds = ids("judgment");
      const caseLawIds = ids("case_law");
      const quickCodeIds = ids("quick_code");
      const benchNoteIds = ids("bench_note");
      const caseIds = ids("case");
      const statuteIds = ids("statute");
      const provisionIds = ids("statute_provision");

      const [dm, j, cl, qc, bn, c, s, sp] = await Promise.all([
        docketMatterIds.length
          ? supabase.from("docket_matters").select("id, matter_title, case_number").in("id", docketMatterIds)
          : Promise.resolve({ data: [], error: null }),
        judgmentIds.length
          ? supabase.from("judgments").select("id, title, case_number").in("id", judgmentIds)
          : Promise.resolve({ data: [], error: null }),
        caseLawIds.length
          ? supabase.from("case_law").select("id, case_name, citation").in("id", caseLawIds)
          : Promise.resolve({ data: [], error: null }),
        quickCodeIds.length
          ? supabase.from("quick_codes").select("id, code_word, title").in("id", quickCodeIds)
          : Promise.resolve({ data: [], error: null }),
        benchNoteIds.length
          ? supabase.from("bench_notes").select("id, title").in("id", benchNoteIds)
          : Promise.resolve({ data: [], error: null }),
        caseIds.length
          ? supabase.from("cases").select("id, title, case_number").in("id", caseIds)
          : Promise.resolve({ data: [], error: null }),
        statuteIds.length
          ? supabase.from("statutes").select("id, title, code").in("id", statuteIds)
          : Promise.resolve({ data: [], error: null }),
        provisionIds.length
          ? supabase
              .from("statute_provisions")
              .select("id, number, heading, level, statute_id, statutes(title)")
              .in("id", provisionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      dm.data?.forEach((r) => map.set(`docket_matter:${r.id}`, { label: r.matter_title, subtitle: r.case_number }));
      j.data?.forEach((r) => map.set(`judgment:${r.id}`, { label: r.title, subtitle: r.case_number }));
      cl.data?.forEach((r) => map.set(`case_law:${r.id}`, { label: r.case_name, subtitle: r.citation }));
      qc.data?.forEach((r) => map.set(`quick_code:${r.id}`, { label: r.title || r.code_word, subtitle: r.code_word }));
      bn.data?.forEach((r) => map.set(`bench_note:${r.id}`, { label: r.title, subtitle: null }));
      c.data?.forEach((r) => map.set(`case:${r.id}`, { label: r.title, subtitle: r.case_number }));
      s.data?.forEach((r) => map.set(`statute:${r.id}`, { label: r.title, subtitle: r.code }));
      (sp.data as unknown as Array<{
        id: string;
        number: string | null;
        heading: string | null;
        level: string;
        statute_id: string;
        statutes: { title: string } | null;
      }> | null)?.forEach((r) => {
        const provisionLabel = r.heading || `${r.level} ${r.number ?? ""}`.trim();
        map.set(`statute_provision:${r.id}`, {
          label: r.statutes ? `${r.statutes.title} — ${provisionLabel}` : provisionLabel,
          subtitle: r.number ? `${r.level} ${r.number}` : r.level,
          parentId: r.statute_id,
        });
      });

      return map;
    },
    enabled: !!bookmarks && bookmarks.length > 0,
    meta: { silent: true },
  });
}
