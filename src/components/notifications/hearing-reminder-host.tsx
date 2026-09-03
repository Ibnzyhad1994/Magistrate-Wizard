import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useFeatureFlag } from "@/hooks/use-feature-flags"
import {
  guyanaCalendarDate,
  hearingReminderDue,
  loadHearingReminderPrefs,
  reminderDedupeKey,
} from "@/lib/hearing-reminders"
import { LOCAL_STORAGE_KEYS } from "@/lib/constants"
import { loadDeviceValue, saveDeviceValue } from "@/lib/device-storage"
import { addCalendarDays } from "@/lib/google-calendar/map-event"

const loadSent = async () => {
  const raw = await loadDeviceValue(LOCAL_STORAGE_KEYS.hearingReminderSent)
  if (!raw) return new Set<string>()
  try {
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed)
  } catch {
    return new Set<string>()
  }
}

/**
 * Device-local sitting-day reminders. Uses the web Notifications API
 * (no header bell, no email). Dedupes per event and date on this device.
 */
export function HearingReminderHost() {
  const { user } = useAuth()
  const { enabled: flagOn } = useFeatureFlag("hearing_reminders")
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 15 * 60_000)
    return () => window.clearInterval(id)
  }, [])

  const from = guyanaCalendarDate(new Date())
  const to = addCalendarDays(from, 1)
  const hearings = useQuery({
    queryKey: ["hearing-reminders", from, to, tick, user?.id],
    enabled: Boolean(user) && flagOn,
    queryFn: async () => {
      const prefs = await loadHearingReminderPrefs()
      if (!prefs.enabled || typeof Notification === "undefined") return []
      if (Notification.permission !== "granted") return []
      const { data, error } = await supabase
        .from("docket_events")
        .select("id, scheduled_date, event_status, docket_matters(case_number, matter_title)")
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .eq("event_status", "scheduled")
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        scheduled_date: row.scheduled_date,
        event_status: row.event_status,
        title:
          (Array.isArray(row.docket_matters)
            ? row.docket_matters[0]?.matter_title
            : row.docket_matters?.matter_title) ?? "Hearing",
        caseNumber:
          (Array.isArray(row.docket_matters)
            ? row.docket_matters[0]?.case_number
            : row.docket_matters?.case_number) ?? "",
      }))
    },
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!hearings.data || hearings.data.length === 0) return
    let cancelled = false
    const run = async () => {
      const prefs = await loadHearingReminderPrefs()
      if (!prefs.enabled) return
      const sent = await loadSent()
      const now = new Date()
      const nextSent = new Set(sent)
      for (const hearing of hearings.data ?? []) {
        if (
          !hearingReminderDue({
            scheduledDate: hearing.scheduled_date,
            eventStatus: hearing.event_status,
            now,
            leadHours: prefs.leadHours,
          })
        ) {
          continue
        }
        const key = reminderDedupeKey(hearing.id, hearing.scheduled_date)
        if (nextSent.has(key)) continue
        if (cancelled || typeof Notification === "undefined") return
        try {
          new Notification("Sitting-day reminder", {
            body: [hearing.caseNumber, hearing.title].filter(Boolean).join(" — "),
          })
          nextSent.add(key)
        } catch {
          return
        }
      }
      if (nextSent.size !== sent.size) {
        await saveDeviceValue(
          LOCAL_STORAGE_KEYS.hearingReminderSent,
          JSON.stringify([...nextSent]),
        )
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [hearings.data])

  return null
}
