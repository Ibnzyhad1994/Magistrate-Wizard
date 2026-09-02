import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ChevronDown, History } from "lucide-react"
import { BrowseHeader, BrowsePage } from "@/components/browse"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/empty-state"
import { InlineError } from "@/components/common/inline-error"
import { formatDateTime } from "@/lib/utils"
import {
  type ActivityFilter,
  actorDisplayName,
  changedFields,
  matchesActivityQuery,
  summarizeAuthEvent,
  summarizeChange,
} from "@/lib/audit-activity"
import {
  useAuditActivity,
  type ActivityRow,
} from "@/hooks/admin/use-audit-activity"

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "access", label: "Access" },
  { id: "library", label: "Library" },
  { id: "docket", label: "Docket" },
  { id: "signin", label: "Sign-in" },
]

const summarizeRow = (row: ActivityRow) => {
  if (row.kind === "auth") {
    return summarizeAuthEvent(row.eventType, row.email)
  }
  return summarizeChange(row.tableName, row.action, row.oldData, row.newData)
}

/**
 * Admin-only ledger of institutional changes and sign-in events.
 * Docket identity edits, bin, and purge appear here. Private judicial
 * writing (bench notes, judgment text) is not listed even though some
 * of those tables are still written to audit_log for SQL review.
 */
const AuditActivityAdminPage = () => {
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState<ActivityFilter>("all")
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: rows, isPending, isError, error, refetch } = useAuditActivity(filter)

  const visible = useMemo(() => {
    const list = rows ?? []
    return list.filter((row) => {
      const summary = summarizeRow(row)
      const actor = actorDisplayName(
        row.actor,
        row.kind === "auth" ? row.email : null,
      )
      return matchesActivityQuery(query, [
        summary.title,
        summary.subject,
        summary.badge,
        actor,
        row.kind === "auth" ? row.email : row.tableName,
      ])
    })
  }, [rows, query])

  const handleToggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id))
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Activity"
        description="Who changed court access, the legal library, docket identity and bin/purge events, or account privileges, and who signed in. Private judicial writing is not shown here."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === item.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-white/15 text-white/70 hover:bg-white/5"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or event"
          aria-label="Search activity"
          className="max-w-xs"
        />
      </div>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing recorded"
          description="Institutional changes and sign-ins will appear here once they happen."
        />
      ) : (
        <ol className="max-w-3xl space-y-2">
          {visible.map((row) => {
            const summary = summarizeRow(row)
            const actor = actorDisplayName(
              row.actor,
              row.kind === "auth" ? row.email : null,
            )
            const expanded = expandedId === row.id
            const details =
              row.kind === "change" ? changedFields(row.oldData, row.newData) : []
            const canExpand = row.kind === "change" ? details.length > 0 : Boolean(row.userAgent)

            return (
              <li key={row.id}>
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-start gap-3">
                      <time
                        dateTime={row.createdAt}
                        className="w-[7.5rem] shrink-0 pt-0.5 font-mono text-[11px] leading-4 text-white/45"
                      >
                        {formatDateTime(row.createdAt)}
                      </time>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={summary.category === "signin" ? "outline" : "secondary"}
                          >
                            {summary.badge}
                          </Badge>
                          <p className="text-sm font-medium text-foreground">{summary.title}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {actor}
                          {summary.subject && summary.subject !== actor
                            ? ` · ${summary.subject}`
                            : ""}
                        </p>
                        {canExpand ? (
                          <button
                            type="button"
                            onClick={() => handleToggleExpanded(row.id)}
                            aria-expanded={expanded}
                            aria-label={expanded ? "Hide details" : "Show details"}
                            className="inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-white"
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                              aria-hidden="true"
                            />
                            {expanded ? "Hide details" : "Show details"}
                          </button>
                        ) : null}
                        {expanded && row.kind === "change" ? (
                          <dl className="grid grid-cols-[minmax(0,8rem)_1fr_1fr] gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-[11px]">
                            <div className="contents text-white/40">
                              <span>Field</span>
                              <span>Before</span>
                              <span>After</span>
                            </div>
                            {details.map((field) => (
                              <div key={field.label} className="contents text-white/75">
                                <dt className="truncate capitalize">{field.label}</dt>
                                <dd className="truncate">{field.from}</dd>
                                <dd className="truncate">{field.to}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        {expanded && row.kind === "auth" && row.userAgent ? (
                          <p className="border-t border-white/10 pt-2 text-[11px] text-white/50">
                            {row.userAgent}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </BrowsePage>
  )
}

export default AuditActivityAdminPage
