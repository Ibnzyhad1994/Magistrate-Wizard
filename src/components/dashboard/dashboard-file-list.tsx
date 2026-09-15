import { Link } from "react-router-dom"
import { DashboardHeading } from "@/components/dashboard/dashboard-folio"
import { Button } from "@/components/ui/button"
import {
  DASHBOARD_FILE_FOCUS_COPY,
  type DashboardFileFocus,
  type DashboardFileRow,
} from "@/lib/dashboard-insights"
import { ROUTES } from "@/routes/paths"

export function DashboardFileList({
  focus,
  rows,
  isPending = false,
  boardCapped = false,
}: {
  focus: DashboardFileFocus
  rows: DashboardFileRow[]
  isPending?: boolean
  boardCapped?: boolean
}) {
  const copy = DASHBOARD_FILE_FOCUS_COPY[focus]

  return (
    <section aria-labelledby="dashboard-file-list-heading">
      <DashboardHeading
        id="dashboard-file-list-heading"
        hintLabel={`How ${copy.title} is listed`}
        hint={copy.why}
      >
        {copy.title}
      </DashboardHeading>
      {boardCapped && (
        <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted-foreground">{copy.cappedNote}</p>
      )}
      {isPending ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">Reading the files in view…</p>
      ) : rows.length === 0 ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">None on the files in view.</p>
      ) : (
        <ol className="divide-y divide-foreground/10 border-y border-foreground/15">
          {rows.map((row, index) => {
            const ordinal = String(index + 1).padStart(2, "0")
            return (
              <li key={row.id}>
                <Link
                  to={row.href}
                  className="group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[3rem_minmax(0,8rem)_minmax(0,1fr)] sm:gap-4"
                >
                  <span className="font-brand text-lg tabular-nums tracking-wide text-foreground/55 group-hover:text-foreground">
                    {ordinal}
                  </span>
                  <span className="hidden truncate font-brand text-sm tabular-nums tracking-wide text-muted-foreground sm:block">
                    {row.case_number || "—"}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-brand text-sm tabular-nums tracking-wide text-muted-foreground sm:hidden">
                      {row.case_number || "—"}
                    </span>
                    <span className="block text-base font-medium leading-snug text-foreground group-hover:text-primary">
                      {row.title}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{row.detail}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
      <div className="mt-6">
        <Button asChild variant="link" className="h-auto justify-start px-0">
          <Link to={ROUTES.dashboard}>Back to briefing</Link>
        </Button>
      </div>
    </section>
  )
}
