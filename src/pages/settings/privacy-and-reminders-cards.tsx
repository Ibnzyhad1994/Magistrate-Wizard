import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useFeatureFlag } from "@/hooks/use-feature-flags"
import { useDownloadMyData } from "@/hooks/admin/use-operations"
import {
  HEARING_REMINDER_LEAD_HOURS,
  isHearingReminderLeadHours,
  loadHearingReminderPrefs,
  saveHearingReminderPrefs,
  type HearingReminderPrefs,
} from "@/lib/hearing-reminders"
import { toast } from "sonner"

export function HearingRemindersCard() {
  const { enabled: flagOn } = useFeatureFlag("hearing_reminders")
  const [prefs, setPrefs] = useState<HearingReminderPrefs | null>(null)

  useEffect(() => {
    void loadHearingReminderPrefs().then(setPrefs)
  }, [])

  if (!flagOn || !prefs) return null

  const handleEnabled = async (checked: boolean) => {
    if (checked && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        toast.error("This browser did not allow sitting-day reminders")
        return
      }
    }
    const next = { ...prefs, enabled: checked }
    setPrefs(next)
    await saveHearingReminderPrefs(next)
  }

  const handleLead = async (value: string) => {
    const leadHours = Number(value)
    if (!isHearingReminderLeadHours(leadHours)) return
    const next = { ...prefs, leadHours }
    setPrefs(next)
    await saveHearingReminderPrefs(next)
  }

  return (
    <Card className="mt-6 max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Sitting-day reminders</CardTitle>
        <CardDescription>
          This device can show a browser notification before listed hearings. This is not an in-app bell and it does not send email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={prefs.enabled}
            onCheckedChange={(checked) => void handleEnabled(checked === true)}
            aria-label="Enable sitting-day reminders on this device"
          />
          Remind me on this device
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="reminder-lead">Lead time</Label>
          <Select
            id="reminder-lead"
            className="max-w-xs"
            value={String(prefs.leadHours)}
            onChange={(event) => void handleLead(event.target.value)}
            disabled={!prefs.enabled}
            aria-label="Reminder lead time"
          >
            {HEARING_REMINDER_LEAD_HOURS.map((hours) => (
              <option key={hours} value={hours}>
                {hours} hours
              </option>
            ))}
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

export function DownloadMyDataCard() {
  const { enabled: flagOn } = useFeatureFlag("download_my_data")
  const download = useDownloadMyData()

  if (!flagOn) return null

  const handleDownload = async () => {
    const payload = await download.mutateAsync()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `magistrate-wizard-data-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="mt-6 max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Download my data</CardTitle>
        <CardDescription>
          A JSON file of records you own (profile, judgments, notes, shares, notices). It does not include other people&apos;s files.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleDownload()}
          disabled={download.isPending}
        >
          {download.isPending ? "Preparing…" : "Download JSON"}
        </Button>
      </CardContent>
    </Card>
  )
}
