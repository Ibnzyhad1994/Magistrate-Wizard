import { useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { Pencil, Trash2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  useBinDocketMatter,
  useDocketMatter,
  usePurgeDocketMatter,
  useRestoreDocketMatter,
} from "@/hooks/docket/use-docket-matters";
import { formatDateTime, toTitleCase } from "@/lib/utils";
import { docketBinDaysLabel, docketBinPurgeAt, isDocketMatterBinned } from "@/lib/docket-bin";
import { OverviewSection } from "@/pages/docket/sections/overview-section";
import { PartiesSection } from "@/pages/docket/sections/parties-section";
import { TagsSection } from "@/pages/docket/sections/tags-section";
import { JudgmentsSection } from "@/pages/docket/sections/judgments-section";
import { CaseLawSection } from "@/pages/docket/sections/case-law-section";
import { DocumentsPanel } from "@/components/common/documents-panel";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { Billboard } from "@/components/browse";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { SharingSection } from "@/pages/docket/sections/sharing-section";
import { EditDocketMatterDetailsDialog } from "@/pages/docket/edit-docket-matter-details-dialog";
import { ROUTES } from "@/routes/paths";
import { useBackNav } from "@/hooks/use-back-nav";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
};

const MATTER_TABS = [
  "overview",
  "parties",
  "tags",
  "judgments",
  "case-law",
  "documents",
  "sharing",
] as const;

export default function DocketMatterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "overview";
  const tab = (MATTER_TABS as readonly string[]).includes(tabParam) ? tabParam : "overview";
  const back = useBackNav(ROUTES.docket, "Back to Docket");
  const { data: matter, isPending, isError, error, refetch } = useDocketMatter(id);
  const { data: access } = useDocketMatterAccess(id);
  const { data: coverUrls } = useSignedUrls([matter?.cover_image_path]);
  const [editOpen, setEditOpen] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const canEdit = access?.canEdit ?? false;
  const isBinned = matter ? isDocketMatterBinned(matter) : false;
  const liveEdit = canEdit && !isBinned;
  const binMatter = useBinDocketMatter(matter?.id ?? "");
  const restoreMatter = useRestoreDocketMatter(matter?.id);
  const purgeMatter = usePurgeDocketMatter(matter?.id);

  if (isPending) {
    return (
      <div className="browse-gutter space-y-4 pt-24">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return <InlineError error={error} onRetry={() => void refetch()} />;
  }

  if (!matter) {
    return (
      <InlineError
        error={
          new Error(
            "This matter doesn't exist, or you don't currently have access to it.",
          )
        }
      />
    );
  }

  const badges = [
    toTitleCase(matter.status),
    ...(isBinned ? ["In the bin"] : []),
  ];

  return (
    <>
      <Billboard
        variant="detail"
        eyebrow={matter.case_number}
        title={matter.matter_title}
        description={
          [matter.courts?.name, matter.magisterial_districts?.name].filter(Boolean).join(" · ") ||
          undefined
        }
        badges={badges}
        tone="docket"
        imageUrl={
          matter.cover_image_path ? coverUrls?.[matter.cover_image_path] : undefined
        }
        primaryAction={{ label: back.label, onClick: () => navigate(back.to) }}
        secondaryAction={
          liveEdit
            ? { label: "Edit details", onClick: () => setEditOpen(true) }
            : undefined
        }
      />
      <div className="browse-gutter relative z-10 -mt-6 space-y-4 pb-20">
        {isBinned && matter.deleted_at && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">This file is in the bin</p>
            <p className="mt-1 text-muted-foreground">
              Permanently deleted after {formatDateTime(docketBinPurgeAt(matter.deleted_at).toISOString())}{" "}
              ({docketBinDaysLabel(matter.deleted_at)}). Restore it to work on it again, or empty it now.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {canEdit && (
                <>
                  <Button
                    size="sm"
                    onClick={() => restoreMatter.mutate(matter.id)}
                    disabled={restoreMatter.isPending}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPurgeOpen(true)}
                    disabled={purgeMatter.isPending}
                  >
                    Empty now
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" asChild>
                <Link to={ROUTES.docketBin}>Open bin</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_VARIANT[matter.status] ?? "outline"}>
            {toTitleCase(matter.status)}
          </Badge>
          <BookmarkToggle entityType="docket_matter" entityId={matter.id} />
          {liveEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit details
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setBinOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Move to bin
              </Button>
            </>
          )}
        </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "overview") next.delete("tab");
          else next.set("tab", value);
          setSearchParams(next, { replace: true });
        }}
        className="w-full"
      >
        <TabsList className="sticky top-[calc(68px+env(safe-area-inset-top))] z-20 bg-[#141414] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="parties">Parties</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="judgments">Judgments</TabsTrigger>
          <TabsTrigger value="case-law">Case Law</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="sharing">Sharing</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewSection matter={matter} />
        </TabsContent>
        <TabsContent value="parties">
          <PartiesSection matterId={matter.id} frozen={isBinned} />
        </TabsContent>
        <TabsContent value="tags">
          <TagsSection matterId={matter.id} frozen={isBinned} />
        </TabsContent>
        <TabsContent value="judgments">
          <JudgmentsSection matterId={matter.id} frozen={isBinned} />
        </TabsContent>
        <TabsContent value="case-law">
          <CaseLawSection matterId={matter.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel
            entityType="docket_matter"
            entityId={matter.id}
            canUpload={liveEdit}
          />
        </TabsContent>
        <TabsContent value="sharing">
          <SharingSection matterId={matter.id} frozen={isBinned} />
        </TabsContent>
      </Tabs>
    </div>

      <EditDocketMatterDetailsDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        matter={matter}
      />
      <AlertDialog
        open={binOpen}
        onOpenChange={setBinOpen}
        title="Move this matter to the bin?"
        description="It leaves the working docket immediately and is permanently deleted after 7 days. You can restore it from the bin until then."
        confirmLabel="Move to bin"
        isConfirming={binMatter.isPending}
        onConfirm={() => {
          binMatter.mutate(undefined, {
            onSuccess: () => setBinOpen(false),
          });
        }}
      />
      <AlertDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Permanently delete this matter?"
        description="This cannot be undone. The file, its hearings, parties, tags, shares, and linked documents are removed. Judgments and case law themselves are kept."
        confirmLabel="Empty now"
        isConfirming={purgeMatter.isPending}
        onConfirm={() => {
          purgeMatter.mutate(matter.id, {
            onSuccess: () => {
              setPurgeOpen(false);
              navigate(ROUTES.docketBin);
            },
          });
        }}
      />
    </>
  );
}
