import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug } from "lucide-react";
import { HintTooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useCreateIssueReport } from "@/hooks/use-issue-reports";
import { APP_VERSION } from "@/lib/app-version";

/**
 * Global "Report an issue" entry point, rendered once in the app Header
 * so it's reachable from every authenticated page. Files straight into
 * `issue_reports` (see 0103_issue_reports.sql) — no external service, so
 * it works the same in dev and production with nothing extra to configure.
 */
export function ReportIssueButton() {
  const location = useLocation();
  const { profile } = useAuth();
  const createReport = useCreateIssueReport();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"bug" | "suggestion">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setType("bug");
    setTitle("");
    setDescription("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    await createReport.mutateAsync({
      type,
      title,
      description,
      pagePath: location.pathname + location.search,
      appVersion: APP_VERSION,
      reporterRole: profile?.role ?? null,
    });
    reset();
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <HintTooltip label="Report a bug or suggestion">
      <Button
        variant="ghost"
        size="icon"
        className="min-h-11 min-w-11 shrink-0 touch-manipulation text-white hover:bg-white/10"
        onClick={() => setOpen(true)}
        aria-label="Report a bug or suggestion"
      >
        <Bug className="h-5 w-5" />
      </Button>
      </HintTooltip>
      <DialogContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-1 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Report an issue</DialogTitle>
            <DialogDescription>
              Found a bug, or have an idea? Tell us what happened. This goes straight to the
              team.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={type === "bug" ? "default" : "outline"}
                aria-pressed={type === "bug"}
                onClick={() => setType("bug")}
                className={cn("flex-1")}
              >
                Bug
              </Button>
              <Button
                type="button"
                size="sm"
                variant={type === "suggestion" ? "default" : "outline"}
                aria-pressed={type === "suggestion"}
                onClick={() => setType("suggestion")}
                className={cn("flex-1")}
              >
                Suggestion
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-report-title">Title</Label>
            <Input
              id="issue-report-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={
                type === "bug" ? "e.g. Calendar month view won't load" : "e.g. Add dark mode to PDF viewer"
              }
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-report-description">Description</Label>
            <Textarea
              id="issue-report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={5}
              placeholder={
                type === "bug"
                  ? "What did you do, what happened, and what did you expect instead?"
                  : "What would you like to see, and why would it help?"
              }
              required
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            We'll automatically include this page and your app version with the report.
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createReport.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createReport.isPending}>
              {createReport.isPending ? "Sending…" : "Send report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
