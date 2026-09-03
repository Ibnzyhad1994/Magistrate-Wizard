import { loadDeviceValue, saveDeviceValue } from "@/lib/device-storage"
import { LOCAL_STORAGE_KEYS } from "@/lib/constants"

export const GUYANA_TIME_ZONE = "America/Guyana"
export const HEARING_REMINDER_LEAD_HOURS = [12, 24] as const
export type HearingReminderLeadHours = (typeof HEARING_REMINDER_LEAD_HOURS)[number]

export interface HearingReminderPrefs {
  enabled: boolean
  leadHours: HearingReminderLeadHours
}

export const DEFAULT_HEARING_REMINDER_PREFS: HearingReminderPrefs = {
  enabled: false,
  leadHours: 24,
}

export const isHearingReminderLeadHours = (value: number): value is HearingReminderLeadHours =>
  (HEARING_REMINDER_LEAD_HOURS as readonly number[]).includes(value)

export const parseHearingReminderPrefs = (raw: string | null): HearingReminderPrefs => {
  if (!raw) return { ...DEFAULT_HEARING_REMINDER_PREFS }
  try {
    const parsed = JSON.parse(raw) as Partial<HearingReminderPrefs>
    const leadHours = Number(parsed.leadHours)
    return {
      enabled: parsed.enabled === true,
      leadHours: isHearingReminderLeadHours(leadHours) ? leadHours : 24,
    }
  } catch {
    return { ...DEFAULT_HEARING_REMINDER_PREFS }
  }
}

export const loadHearingReminderPrefs = async () =>
  parseHearingReminderPrefs(await loadDeviceValue(LOCAL_STORAGE_KEYS.hearingReminders))

export const saveHearingReminderPrefs = async (prefs: HearingReminderPrefs) => {
  await saveDeviceValue(LOCAL_STORAGE_KEYS.hearingReminders, JSON.stringify(prefs))
}

export const guyanaCalendarDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: GUYANA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)

export const addCalendarDays = (dateOnly: string, days: number) => {
  const [year, month, day] = dateOnly.split("-").map(Number)
  const next = new Date(year as number, (month as number) - 1, (day as number) + days)
  const yyyy = String(next.getFullYear())
  const mm = String(next.getMonth() + 1).padStart(2, "0")
  const dd = String(next.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export const hearingReminderDue = (input: {
  scheduledDate: string
  eventStatus: string
  now: Date
  leadHours: number
}) => {
  if (input.eventStatus !== "scheduled") return false
  const today = guyanaCalendarDate(input.now)
  const tomorrow = addCalendarDays(today, 1)
  if (input.leadHours >= 24) {
    return input.scheduledDate === today || input.scheduledDate === tomorrow
  }
  return input.scheduledDate === today
}

export const reminderDedupeKey = (eventId: string, scheduledDate: string) =>
  `hearing-reminder:${eventId}:${scheduledDate}`
