import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsDesktop } from "@/hooks/use-media-query";
import { PROCEDURE_COLUMNS, procedureSetLabel } from "@/lib/docket-procedure";
import { ProcedureColumnHeading } from "@/pages/docket/procedure-column-heading";

const EXAMPLE_CASE_NUMBER = "GEO-2026-EX";
const EXAMPLE_TITLE = "Police v. Example";

const caseColBase =
  "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden bg-[#181818] shadow-[2px_0_0_0_rgba(255,255,255,0.08)] sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";

function ExampleStageChip({
  label,
  isCurrent,
}: {
  label: string;
  isCurrent?: boolean;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded px-2 py-1 text-left text-xs font-medium text-white/40 ${
        isCurrent ? "ring-2 ring-[hsl(var(--match))]" : ""
      } min-h-9 min-w-[5.5rem] sm:min-h-7`}
    >
      {label}
    </span>
  );
}

function ExampleCaseLabel() {
  return (
    <div data-tour="docket-first-matter">
      <p className="truncate text-xs font-semibold text-white/55">{EXAMPLE_CASE_NUMBER}</p>
      <p className="truncate text-sm text-white">{EXAMPLE_TITLE}</p>
    </div>
  );
}

function DesktopExampleSheet() {
  return (
    <div className="relative" data-tour="docket-board">
      <div className="relative rounded-sm border border-white/10">
        <Table className="min-w-[56rem] border-separate border-spacing-0 sm:min-w-[72rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${caseColBase} z-30`}>Case</TableHead>
              {PROCEDURE_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className="sticky top-0 z-20 min-w-[5.75rem] whitespace-nowrap bg-[#181818] sm:min-w-[7rem]"
                  data-tour-focus={column.key === "arraignment_status" ? "" : undefined}
                >
                  <ProcedureColumnHeading columnKey={column.key} label={column.label} />
                </TableHead>
              ))}
              <TableHead
                className="sticky top-0 z-20 min-w-[6.5rem] whitespace-nowrap bg-[#181818] sm:min-w-[7.5rem]"
                data-tour="docket-next-date"
              >
                Next date
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell className={`${caseColBase} z-20`}>
                <ExampleCaseLabel />
              </TableCell>
              {PROCEDURE_COLUMNS.map((column) => (
                <TableCell key={column.key} className="p-1.5">
                  <ExampleStageChip
                    label={procedureSetLabel(column.key)}
                    isCurrent={column.key === "arraignment_status"}
                  />
                </TableCell>
              ))}
              <TableCell className="whitespace-nowrap">
                <span className="whitespace-nowrap rounded px-1.5 py-1 text-left text-xs font-medium text-white/70 underline decoration-dotted underline-offset-2">
                  + Set date
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MobileExampleCard() {
  return (
    <article
      className="rounded-sm border border-white/10 bg-[#181818] p-3"
      data-tour="docket-board"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <ExampleCaseLabel />
        <div className="shrink-0" data-tour="docket-next-date">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Next date
          </p>
          <span className="whitespace-nowrap rounded px-1.5 py-1 text-left text-xs font-medium text-white/70 underline decoration-dotted underline-offset-2">
            + Set date
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PROCEDURE_COLUMNS.map((column) => (
          <div
            key={column.key}
            data-tour-focus={column.key === "arraignment_status" ? "" : undefined}
            className="min-w-0 space-y-1"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ProcedureColumnHeading columnKey={column.key} label={column.label} />
            </p>
            <ExampleStageChip
              label={procedureSetLabel(column.key)}
              isCurrent={column.key === "arraignment_status"}
            />
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Labelled sample sheet for the walkthrough when the docket has no files.
 * Not stored, not clickable, and not a screenshot — live chrome so tour
 * rings land on procedure cells and Next date.
 */
export function DocketTourExample() {
  const isDesktop = useIsDesktop();

  return (
    <section
      aria-label="Example — not a file on your docket"
      className="pointer-events-none select-none"
    >
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Example — not a file on your docket
      </p>
      {isDesktop ? <DesktopExampleSheet /> : <MobileExampleCard />}
    </section>
  );
}
