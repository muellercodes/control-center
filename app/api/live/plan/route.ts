import { getDatabase } from "@/lib/server/database";
import { readWorkspaceState } from "@/lib/workspace-store";
import { readExtensionSettings } from "@/lib/extensions/settings";
import { calendarScope, collectCalendar } from "@/lib/server/extensions/calendar";
import { readExtensionSnapshot } from "@/lib/extensions/store";
import { buildDailyPlan } from "@/lib/extensions/plan";
import { summarizeThroughput } from "@/lib/extensions/throughput";
import type { CalendarFeedResponse } from "@/lib/extensions/types";

export const runtime = "nodejs";

function localDateKey(day: Date) {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

export async function GET(request: Request) {
  const now = new Date();
  const today = localDateKey(now);
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";

  let tasks;
  try {
    tasks = readWorkspaceState(getDatabase()).tasks;
  } catch {
    return Response.json(
      {
        error:
          "Tasks could not be read safely. Restore the local database from a backup before planning.",
      },
      { status: 500 },
    );
  }

  const settings = await readExtensionSettings();

  // Capacity stays null unless a calendar genuinely reported today, so an
  // unconnected or failing calendar never masquerades as a fully booked day.
  let capacityMinutes: number | null = null;
  let calendarState: "connected" | "not-connected" | "unavailable" =
    settings.calendar.refreshToken ? "unavailable" : "not-connected";

  if (settings.calendar.refreshToken) {
    const cached = forceRefresh
      ? null
      : readExtensionSnapshot<CalendarFeedResponse>(
          getDatabase(),
          "calendar",
          calendarScope(settings),
        );
    const feed =
      cached?.payload.days[0]?.date === today
        ? cached.payload
        : await collectCalendar(settings, now);
    const todayEntry = feed.days.find((day) => day.date === today);
    if (todayEntry) {
      capacityMinutes = todayEntry.capacityMinutes;
      calendarState = "connected";
    }
  }

  const evidence = summarizeThroughput(tasks, now);
  const plan = buildDailyPlan({ tasks, capacityMinutes, evidence, now });

  return Response.json({
    checkedAt: now.toISOString(),
    date: today,
    calendarState,
    confidence: evidence.confidence,
    activeDays: evidence.activeDays,
    chronicallyDeferred: evidence.chronicallyDeferred.slice(0, 5),
    ...plan,
  });
}
