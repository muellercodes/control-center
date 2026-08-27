import "server-only";

import {
  capacityMinutes,
  freeWindows,
  type BusyBlock,
} from "@/lib/extensions/availability";
import { normalizeEvents } from "@/lib/extensions/calendar";
import {
  readExtensionSettings,
  saveCalendarTokens,
  type StoredExtensionSettings,
} from "@/lib/extensions/settings";
import type { CalendarDay, CalendarFeedResponse } from "@/lib/extensions/types";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Refreshes the access token only when it is within a minute of expiring. */
export async function getCalendarAccessToken(settings: StoredExtensionSettings) {
  const calendar = settings.calendar;
  if (!calendar.refreshToken || !calendar.googleClientId || !calendar.googleClientSecret)
    throw new Error("Google Calendar is not connected.");
  if (calendar.accessToken && calendar.accessTokenExpiresAt > Date.now() + 60_000)
    return calendar.accessToken;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: calendar.googleClientId,
      client_secret: calendar.googleClientSecret,
      refresh_token: calendar.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok)
    throw new Error(
      "Google rejected the saved calendar connection. Reconnect it on the Calendar tab.",
    );
  const tokens = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  await saveCalendarTokens({
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  return tokens.access_token;
}

function localDateKey(day: Date) {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/**
 * Collects busy blocks and converts them into remaining usable capacity for
 * each of the next `dayCount` local days.
 */
export async function collectCalendar(
  settings?: StoredExtensionSettings,
  now = new Date(),
  dayCount = 7,
): Promise<CalendarFeedResponse> {
  const resolved = settings ?? (await readExtensionSettings());
  const checkedAt = now.toISOString();
  const calendar = resolved.calendar;
  const connected = Boolean(calendar.refreshToken);

  if (!calendar.googleClientId || !calendar.googleClientSecret)
    return { configured: false, connected: false, checkedAt, days: [], errors: [] };
  if (!connected)
    return {
      configured: true,
      connected: false,
      checkedAt,
      days: [],
      errors: [],
    };

  const errors: string[] = [];
  let busy: BusyBlock[] = [];

  try {
    const accessToken = await getCalendarAccessToken(resolved);
    const windowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + dayCount);

    const calendarIds = calendar.calendarIds.length
      ? calendar.calendarIds
      : ["primary"];

    const groups = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const url = new URL(
          `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
        );
        url.search = new URLSearchParams({
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          // Expands recurring series into concrete instances.
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
        }).toString();
        try {
          const response = await fetch(url, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!response.ok)
            throw new Error(`Google Calendar returned ${response.status}.`);
          return normalizeEvents(await response.json());
        } catch (error) {
          // Report the gap rather than quietly presenting a day as free.
          errors.push(
            `${calendarId}: ${error instanceof Error ? error.message : "failed"}`,
          );
          return [];
        }
      }),
    );
    busy = groups.flat();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Calendar check failed.");
    return { configured: true, connected, checkedAt, days: [], errors };
  }

  const options = {
    minimumBlockMinutes: calendar.minimumBlockMinutes,
    contextSwitchMinutes: calendar.contextSwitchMinutes,
    allDayBlocksDay: calendar.allDayBlocksDay,
  };

  const days: CalendarDay[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const windows = freeWindows(busy, day, now, calendar.workingHours, options);
    days.push({
      date: localDateKey(day),
      busy: busy
        .filter((block) => {
          const start = Date.parse(block.start);
          if (!Number.isFinite(start)) return block.allDay && offset === 0;
          const startOfDay = day.getTime();
          return start >= startOfDay && start < startOfDay + 86_400_000;
        })
        .map((block) => ({
          start: block.start,
          end: block.end,
          title: block.title || "Busy",
          allDay: Boolean(block.allDay),
          response: block.response,
        })),
      freeWindows: windows,
      capacityMinutes: capacityMinutes(windows, options),
    });
  }

  return {
    configured: true,
    connected,
    connectedEmail: calendar.connectedEmail,
    checkedAt,
    days,
    errors,
  };
}

/** Snapshot identity: recollect whenever anything affecting capacity changes. */
export function calendarScope(settings: StoredExtensionSettings) {
  return JSON.stringify({
    email: settings.calendar.connectedEmail,
    calendars: settings.calendar.calendarIds,
    hours: settings.calendar.workingHours,
    minimum: settings.calendar.minimumBlockMinutes,
    contextSwitch: settings.calendar.contextSwitchMinutes,
    allDay: settings.calendar.allDayBlocksDay,
  });
}
