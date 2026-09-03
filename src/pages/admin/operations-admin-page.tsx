import { useState } from "react"
import { BrowseHeader, BrowsePage } from "@/components/browse"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/common/inline-error"
import { EmptyState } from "@/components/common/empty-state"
import { FeatureFlag } from "@/components/common/feature-flag"
import { useFeatureFlags, useUpdateFeatureFlag } from "@/hooks/use-feature-flags"
import {
  useCreateWebhookEndpoint,
  useRetentionPolicies,
  useToggleWebhookEndpoint,
  useUpdateRetentionPolicy,
  useWebhookEndpoints,
  useWebhookOutbox,
} from "@/hooks/admin/use-operations"
import { WEBHOOK_EVENTS } from "@/lib/webhooks"
import { RETENTION_ACTIONS, retentionAllowsPurge } from "@/lib/retention"
import { SlidersHorizontal } from "lucide-react"

type OpsTab = "flags" | "retention" | "webhooks"

const newSecret = () => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export default function OperationsAdminPage() {
  const [tab, setTab] = useState<OpsTab>("flags")

  return (
    <BrowsePage>
      <BrowseHeader
        title="Operations"
        description="Feature flags, retention policy, and outbound webhooks. Email delivery is not configured here."
      />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {(
          [
            ["flags", "Flags"],
            ["retention", "Retention"],
            ["webhooks", "Webhooks"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              tab === id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/15 text-white/70 hover:bg-white/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "flags" && <FlagsPanel />}
      {tab === "retention" && <RetentionPanel />}
      {tab === "webhooks" && (
        <FeatureFlag
          flag="webhooks"
          fallback={
            <EmptyState
              icon={SlidersHorizontal}
              title="Webhooks are off"
              description="Turn on the webhooks flag to register outbound endpoints."
            />
          }
        >
          <WebhooksPanel />
        </FeatureFlag>
      )}
    </BrowsePage>
  )
}

const FlagsPanel = () => {
  const { data, isPending, isError, error, refetch } = useFeatureFlags()
  const updateFlag = useUpdateFeatureFlag()

  if (isPending) return <Skeleton className="h-48 w-full" />
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />

  return (
    <div className="max-w-2xl space-y-3">
      {(data ?? []).map((flag) => (
        <Card key={flag.key}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">{flag.key}</CardTitle>
              <CardDescription>
                Rollout {flag.rolloutPercentage}%. Empty court and role lists apply to everyone.
              </CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={flag.enabled}
                onCheckedChange={(checked) =>
                  updateFlag.mutate({ key: flag.key, enabled: checked === true })
                }
                aria-label={`Toggle ${flag.key}`}
              />
              Enabled
            </label>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

const RetentionPanel = () => {
  const { data, isPending, isError, error, refetch } = useRetentionPolicies()
  const updatePolicy = useUpdateRetentionPolicy()

  if (isPending) return <Skeleton className="h-48 w-full" />
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />

  return (
    <div className="max-w-2xl space-y-3">
      {(data ?? []).map((policy) => (
        <Card key={policy.table_name}>
          <CardHeader>
            <CardTitle className="text-base">{policy.table_name}</CardTitle>
            <CardDescription>{policy.notes}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`days-${policy.table_name}`}>Days</Label>
              <Input
                id={`days-${policy.table_name}`}
                type="number"
                min={1}
                defaultValue={policy.retention_days}
                className="w-28"
                onBlur={(event) => {
                  const days = Number(event.target.value)
                  if (!Number.isFinite(days) || days < 1 || days === policy.retention_days) return
                  updatePolicy.mutate({
                    tableName: policy.table_name,
                    retentionDays: days,
                    action: policy.action,
                  })
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`action-${policy.table_name}`}>Action</Label>
              <Select
                id={`action-${policy.table_name}`}
                className="w-36"
                value={policy.action}
                onChange={(event) => {
                  const action = event.target.value
                  if (action === "purge" && !retentionAllowsPurge(policy.table_name, action)) {
                    return
                  }
                  updatePolicy.mutate({
                    tableName: policy.table_name,
                    retentionDays: policy.retention_days,
                    action,
                  })
                }}
              >
                {RETENTION_ACTIONS.map((action) => (
                  <option
                    key={action}
                    value={action}
                    disabled={action === "purge" && policy.table_name !== "notifications"}
                  >
                    {action}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-white/45">
        Only notifications can be purged automatically. Audit log and docket rows stay flagged for review.
      </p>
    </div>
  )
}

const WebhooksPanel = () => {
  const endpoints = useWebhookEndpoints()
  const outbox = useWebhookOutbox()
  const createEndpoint = useCreateWebhookEndpoint()
  const toggle = useToggleWebhookEndpoint()
  const [url, setUrl] = useState("")
  const [events, setEvents] = useState<string[]>(["share.granted"])

  const handleAdd = () => {
    const trimmed = url.trim()
    if (!trimmed || events.length === 0) return
    createEndpoint.mutate(
      { url: trimmed, secret: newSecret(), events },
      { onSuccess: () => setUrl("") },
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add endpoint</CardTitle>
          <CardDescription>
            HTTPS URLs only (localhost is allowed for development). Bodies are HMAC-SHA256 signed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">URL</Label>
            <Input
              id="webhook-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.gov/hooks/magistrate-wizard"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Events</legend>
            {WEBHOOK_EVENTS.map((eventName) => (
              <label key={eventName} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={events.includes(eventName)}
                  onCheckedChange={(checked) => {
                    setEvents((current) =>
                      checked
                        ? [...current, eventName]
                        : current.filter((item) => item !== eventName),
                    )
                  }}
                  aria-label={eventName}
                />
                {eventName}
              </label>
            ))}
          </fieldset>
          <Button type="button" size="sm" onClick={handleAdd} disabled={createEndpoint.isPending}>
            Add endpoint
          </Button>
        </CardContent>
      </Card>

      {endpoints.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : endpoints.isError ? (
        <InlineError error={endpoints.error} onRetry={() => void endpoints.refetch()} />
      ) : (
        <div className="space-y-3">
          {(endpoints.data ?? []).map((endpoint) => (
            <Card key={endpoint.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="break-all text-base">{endpoint.url}</CardTitle>
                  <CardDescription>{endpoint.events.join(", ") || "No events"}</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toggle.mutate({ id: endpoint.id, active: !endpoint.active })}
                >
                  {endpoint.active ? "Disable" : "Enable"}
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
          <CardDescription>
            Pending rows wait for pg_net or the webhook-dispatch function. Failed rows keep the last error.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(outbox.data ?? []).length === 0 ? (
            <p className="text-white/55">No outbound events yet.</p>
          ) : (
            (outbox.data ?? []).map((row) => (
              <div key={row.id} className="rounded-md border border-white/10 px-3 py-2">
                <p>
                  {row.event} · {row.status} · {row.attempts} attempt(s)
                </p>
                {row.last_error && <p className="text-xs text-destructive">{row.last_error}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
