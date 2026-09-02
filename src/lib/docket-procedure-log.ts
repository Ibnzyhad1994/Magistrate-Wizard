import { toast } from "sonner";
import {
  appearanceHintForColumn,
  type ProcedureColumnKey,
} from "@/lib/docket-procedure";

export type ProcedureAppearanceHint = {
  event_type: string;
  stage_at_event: string;
  notes: string;
};

export function patchedUpdatedAt(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("updated_at" in result)) return null;
  const value = (result as { updated_at?: unknown }).updated_at;
  return typeof value === "string" ? value : null;
}

export function notifyProcedureLogged(args: {
  column: ProcedureColumnKey;
  next: string;
  onUndo: () => void;
  onLogAppearance: (hint: ProcedureAppearanceHint) => void;
}): void {
  const hint = appearanceHintForColumn(args.column, args.next);
  toast.success("Logged on the board.", {
    duration: 10000,
    cancel: {
      label: "Undo",
      onClick: args.onUndo,
    },
    action: {
      label: "Log appearance",
      onClick: () => args.onLogAppearance(hint),
    },
  });
}

export async function logProcedurePatch(args: {
  column: ProcedureColumnKey;
  previous: string;
  next: string;
  expectedUpdatedAt: string | null;
  patch: (
    values: Record<string, string>,
    expectedUpdatedAt: string | null,
  ) => Promise<unknown>;
  onLogAppearance: (hint: ProcedureAppearanceHint) => void;
}): Promise<void> {
  try {
    const result = await args.patch({ [args.column]: args.next }, args.expectedUpdatedAt);
    const undoAt = patchedUpdatedAt(result);
    notifyProcedureLogged({
      column: args.column,
      next: args.next,
      onUndo: () => {
        void args.patch({ [args.column]: args.previous }, undoAt).catch(() => {
          // Mutation cache already toasts. Do not retry.
        });
      },
      onLogAppearance: args.onLogAppearance,
    });
  } catch {
    // Mutation cache toast subscriber.
  }
}
