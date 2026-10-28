import { Button } from "@/components/ui/button";

export function SessionIdleWarning({ onContinue }: { onContinue: () => void }) {
  return (
    // The canvas underneath keeps the warning wash opaque over the page.
    <div
      className="fixed inset-x-0 top-[calc(68px+env(safe-area-inset-top,0px))] z-50 border-b border-warning/40 bg-background text-sm text-foreground max-md:text-xs"
      role="status"
    >
      <div className="flex items-center justify-between gap-3 bg-warning/10 px-4 py-2">
        <p>You will be locked out in 5 minutes due to inactivity.</p>
        <Button
          type="button"
          size="sm"
          variant="warning"
          onClick={onContinue}
          aria-label="Continue working and stay signed in"
        >
          Continue working
        </Button>
      </div>
    </div>
  );
}
