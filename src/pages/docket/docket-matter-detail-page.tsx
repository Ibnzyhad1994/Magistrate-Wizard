import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { useDocketMatter } from "@/hooks/docket/use-docket-matters";
import { OverviewSection } from "@/pages/docket/sections/overview-section";
import { EventsSection } from "@/pages/docket/sections/events-section";
import { PartiesSection } from "@/pages/docket/sections/parties-section";
import { TagsSection } from "@/pages/docket/sections/tags-section";
import { JudgmentsSection } from "@/pages/docket/sections/judgments-section";
import { CaseLawSection } from "@/pages/docket/sections/case-law-section";
import { DocumentsPanel } from "@/components/common/documents-panel";
import { SharingSection } from "@/pages/docket/sections/sharing-section";
import { ROUTES } from "@/routes/paths";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
};

export default function DocketMatterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: matter, isPending, isError, error, refetch } = useDocketMatter(id);

  if (isPending) {
    return (
      <div className="space-y-4">
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
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => navigate(ROUTES.docket)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Docket
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {matter.matter_title}
          </h1>
          <Badge variant={STATUS_VARIANT[matter.status] ?? "outline"}>
            {matter.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {matter.case_number}
          {matter.courts?.name ? ` · ${matter.courts.name}` : ""}
          {matter.magisterial_districts?.name
            ? ` · ${matter.magisterial_districts.name}`
            : ""}
        </p>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
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
  );
}
