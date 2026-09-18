import { procedureStageLabel } from "@/lib/docket-procedure";
import { DashboardHeading } from "@/components/dashboard/dashboard-folio";

export function StageLedger({ counts }: { counts: Record<string, number> }) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, count]) => count));

  return (
    <section aria-labelledby="stage-ledger-heading">
      <DashboardHeading
        id="stage-ledger-heading"
        hintLabel="How stage mix is counted"
        hint="Each bar is files on the current board (first 100) at that procedure stage. It is a snapshot of what you can see, not a court-wide census."
      >
        Stage mix
      </DashboardHeading>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files on the board yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(([stage, count]) => (
            <li
              key={stage}
              className="grid grid-cols-[minmax(0,7.5rem)_1fr_1.75rem] items-center gap-3 text-xs"
            >
              <span className="truncate text-muted-foreground">{procedureStageLabel(stage)}</span>
              <span className="h-0.5 bg-foreground/15">
                <span
                  className="block h-0.5 bg-primary"
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </span>
              <span className="font-semibold tabular-nums text-foreground">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Sparkline({ points }: { points: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  const width = 320;
  const height = 72;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : index * step;
    const y = height - 8 - (point.count / max) * (height - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = coords.join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;

  return (
    <section aria-labelledby="sparkline-heading">
      <DashboardHeading
        id="sparkline-heading"
        hintLabel="What this tally shows"
        hint="Each peak is appearances already on the files you can see, day by day for the next fourteen days. It is a pulse, not a forecast."
      >
        Next fourteen days
      </DashboardHeading>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full text-primary"
        role="img"
        aria-label="Appearances over the next two weeks"
      >
        {[0.25, 0.5, 0.75].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={height * line}
            y2={height * line}
            className="stroke-foreground/10"
            strokeWidth="1"
          />
        ))}
        <polygon points={area} fill="currentColor" className="opacity-20" />
        <polyline
          points={polyline}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </section>
  );
}
