import type { BusyBlock, WorkingHours } from "@/lib/extensions/availability";

/**
 * Pure calendar logic: settings validation and Google event normalization.
 * Network access and token handling live in lib/server/extensions/calendar.ts.
 */

const MAX_CALENDARS = 20;

/** Google calendar ids are email-like; anything else is rejected outright. */
export function isCalendarId(value: string) {
  return (
    value === "primary" ||
    (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  );
}

export function cleanCalendarIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = (typeof entry === "string" ? entry : "").trim().toLowerCase();
    if (!id) continue;
    if (!isCalendarId(id)) throw new Error(`"${id}" is not a valid calendar id.`);
    if (seen.size >= MAX_CALENDARS)
      throw new Error(`Track at most ${MAX_CALENDARS} calendars.`);
    seen.add(id);
  }
  return [...seen];
}

/**
 * Working hours must describe a real, forward-going window. A start at or after
 * the end would silently yield zero capacity every day, which reads as "you are
 * fully booked" rather than as the misconfiguration it is.
 */
export function cleanWorkingHours(value: unknown, fallback: WorkingHours): WorkingHours {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<WorkingHours>;
  const minute = (input: unknown, backup: number) =>
    typeof input === "number" && Number.isInteger(input) && input >= 0 && input <= 24 * 60
      ? input
      : backup;
  const startMinute = minute(candidate.startMinute, fallback.startMinute);
  const endMinute = minute(candidate.endMinute, fallback.endMinute);
  if (endMinute <= startMinute)
    throw new Error("The working day must end after it starts.");
  const days = Array.isArray(candidate.days)
    ? [...new Set(candidate.days.filter(
        (day): day is number => Number.isInteger(day) && day >= 0 && day <= 6,
      ))].sort()
    : fallback.days;
  if (!days.length) throw new Error("Choose at least one working day.");
  return { startMinute, endMinute, days };
}

type GoogleEvent = Record<string, unknown>;

function attendeeResponse(event: GoogleEvent): BusyBlock["response"] {
  const attendees = event.attendees;
  if (!Array.isArray(attendees)) return "accepted";
  const self = attendees.find(
    (attendee) =>
      attendee && typeof attendee === "object" &&
      (attendee as { self?: unknown }).self === true,
  ) as { responseStatus?: unknown } | undefined;
  const status = typeof self?.responseStatus === "string" ? self.responseStatus : "";
  if (status === "declined" || status === "tentative" || status === "needsAction")
    return status;
  return "accepted";
}

/**
 * Google returns `dateTime` for timed events and `date` for all-day ones.
 * Events the user marked "free" (transparent) never consume working time.
 */
export function normalizeEvents(payload: unknown): BusyBlock[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const event = entry as GoogleEvent;
    if (event.status === "cancelled") return [];
    if (event.transparency === "transparent") return [];
    const start = event.start as { dateTime?: unknown; date?: unknown } | undefined;
    const end = event.end as { dateTime?: unknown; date?: unknown } | undefined;
    const startValue =
      typeof start?.dateTime === "string"
        ? start.dateTime
        : typeof start?.date === "string"
          ? start.date
          : "";
    const endValue =
      typeof end?.dateTime === "string"
        ? end.dateTime
        : typeof end?.date === "string"
          ? end.date
          : "";
    if (!startValue || !endValue) return [];
    return [{
      start: startValue,
      end: endValue,
      title: typeof event.summary === "string" ? event.summary : "Busy",
      allDay: typeof start?.dateTime !== "string",
      response: attendeeResponse(event),
    }];
  });
}
