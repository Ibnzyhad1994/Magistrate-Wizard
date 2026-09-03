import { Button } from "@/components/ui/button";

export function SessionIdleWarning({ onContinue }: { onContinue: () => void }) {
  return (
    <div
      className="fixed inset-x-0 top-[calc(68px+env(safe-area-inset-top,0px))] z-50 flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-950/90 px-4 py-2 text-sm text-amber-50 backdrop-blur-sm max-md:text-xs"
      role="status"
    >
      <p>You will be locked out in 5 minutes due to inactivity.</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onContinue}
        aria-label="Continue working and stay signed in"
      >
        Continue working
      </Button>
    </div>
  );
}
