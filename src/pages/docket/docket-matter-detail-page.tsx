import { useParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { useDocketMatter } from "@/hooks/docket/use-docket-matters";
import { toTitleCase } from "@/lib/utils";
import { OverviewSection } from "@/pages/docket/sections/overview-section";
import { EventsSection } from "@/pages/docket/sections/events-section";
import { PartiesSection } from "@/pages/docket/sections/parties-section";
import { TagsSection } from "@/pages/docket/sections/tags-section";
import { JudgmentsSection } from "@/pages/docket/sections/judgments-section";
import { CaseLawSection } from "@/pages/docket/sections/case-law-section";
import { DocumentsPanel } from "@/components/common/documents-panel";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { Billboard } from "@/components/browse";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { SharingSection } from "@/pages/docket/sections/sharing-section";
import { ROUTES } from "@/routes/paths";
import { useBackNav } from "@/hooks/use-back-nav";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
};

export default function DocketMatterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const back = useBackNav(ROUTES.docket, "Back to Docket");
  const { data: matter, isPending, isError, error, refetch } = useDocketMatter(id);
  const { data: coverUrls } = useSignedUrls([matter?.cover_image_path]);

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

  return (
    <>
      <Billboard
        variant="detail"
        eyebrow={matter.case_number}
        title={matter.matter_title}
        description={
          [matter.charge_or_issue, matter.courts?.name, matter.magisterial_districts?.name]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        badges={[toTitleCase(matter.status)]}
        tone="docket"
        imageUrl={
          matter.cover_image_path ? coverUrls?.[matter.cover_image_path] : undefined
        }
        primaryAction={{ label: back.label, onClick: () => navigate(back.to) }}
      />
      <div className="browse-gutter relative z-10 -mt-6 space-y-4 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_VARIANT[matter.status] ?? "outline"}>
            {toTitleCase(matter.status)}
          </Badge>
          <BookmarkToggle entityType="docket_matter" entityId={matter.id} />
        </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="sticky top-[68px] z-20 bg-[#141414] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
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
        <TabsContent value="events">
          <EventsSection matterId={matter.id} />
        </TabsContent>
        <TabsContent value="parties">
          <PartiesSection matterId={matter.id} />
        </TabsContent>
        <TabsContent value="tags">
          <TagsSection matterId={matter.id} />
        </TabsContent>
        <TabsContent value="judgments">
          <JudgmentsSection matterId={matter.id} />
        </TabsContent>
        <TabsContent value="case-law">
          <CaseLawSection matterId={matter.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel entityType="docket_matter" entityId={matter.id} />
        </TabsContent>
        <TabsContent value="sharing">
          <SharingSection matterId={matter.id} />
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}
