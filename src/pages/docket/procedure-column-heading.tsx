import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  FolderOpen,
  Gavel,
  Mail,
  Scale,
  ScrollText,
  Shield,
  Stamp,
  Undo2,
  UserRound,
} from "lucide-react";
import type { ProcedureColumnKey } from "@/lib/docket-procedure";

const PROCEDURE_COLUMN_ICONS: Record<ProcedureColumnKey, LucideIcon> = {
  arraignment_status: UserRound,
  custody_status: Shield,
  disclosure_status: FolderOpen,
  trial_status: Gavel,
  paper_committal_status: FileText,
  ruling_status: ScrollText,
  judgment_status: Scale,
  sentence_status: Stamp,
  appeal_status: Undo2,
  information_sworn_status: ClipboardCheck,
  summons_served: Mail,
  returns_of_summons: Mail,
  civil_trial_held: Gavel,
  decision: BadgeCheck,
};

export function ProcedureColumnHeading({
  columnKey,
  label,
}: {
  columnKey: ProcedureColumnKey;
  label: string;
}) {
  const Icon = PROCEDURE_COLUMN_ICONS[columnKey] ?? CircleDollarSign;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
      {label}
    </span>
  );
}
