import { getDatabase } from "@/lib/server/database";
import { readExtensionSettings } from "@/lib/extensions/settings";
import { calendarScope, collectCalendar } from "@/lib/server/extensions/calendar";
import {
  readExtensionSnapshot,
  writeExtensionSnapshot,
} from "@/lib/extensions/store";
import type { CalendarFeedResponse } from "@/lib/extensions/types";

export const runtime = "nodejs";

const EXTENSION = "calendar";

export async function GET(request: Request) {
  const settings = await readExtensionSettings();
  const scope = calendarScope(settings);
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const database = getDatabase();

  if (!forceRefresh) {
    const cached = readExtensionSnapshot<CalendarFeedResponse>(
      database,
      EXTENSION,
      scope,
    );
    // A cached day is only meaningful while it is still that day; capacity is
    // measured from "now", so a stale snapshot would overstate remaining time.
    if (cached && cached.payload.days[0]?.date === localDateKey(new Date()))
      return Response.json({ ...cached.payload, cached: true });
  }

  const payload = await collectCalendar(settings);
  const failedOutright = payload.errors.length && !payload.days.length;
  if (!failedOutright) writeExtensionSnapshot(database, EXTENSION, scope, payload);
  return Response.json(payload);
}

function localDateKey(day: Date) {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}
