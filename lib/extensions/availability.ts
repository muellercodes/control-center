/**
 * Turns busy blocks into hours you could realistically work.
 *
 * Source-agnostic on purpose: Google Calendar, an .ics feed, or a hand-entered
 * block all reduce to the same BusyBlock shape, so the definition of "free"
 * lives in one tested place.
 *
 * The core idea is that raw free time overstates capacity. A 15-minute gap
 * between two meetings is not 15 minutes of work, and every window costs
 * something to pick up and put down. Both are modelled explicitly rather than
 * left for the user to discount in their head.
 */

export type BusyBlock = {
  start: string;
  end: string;
  title?: string;
  allDay?: boolean;
  /** Google's responseStatus, normalized. */
  response?: "accepted" | "tentative" | "declined" | "needsAction";
};

export type WorkingHours = {
  /** Minutes from local midnight. */
  startMinute: number;
  endMinute: number;
  /** Local day numbers, 0 = Sunday. */
  days: number[];
};

export type CapacityOptions = {
  /** Gaps shorter than this are not usable work time at all. */
  minimumBlockMinutes: number;
  /** Deducted from each usable window for picking the work back up. */
  contextSwitchMinutes: number;
  /** Whether an all-day event consumes the working day. */
  allDayBlocksDay: boolean;
};

export type FreeWindow = { start: string; end: string; minutes: number };

export const defaultWorkingHours: WorkingHours = {
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  days: [1, 2, 3, 4, 5],
};

export const defaultCapacityOptions: CapacityOptions = {
  minimumBlockMinutes: 25,
  contextSwitchMinutes: 5,
  allDayBlocksDay: false,
};

function atLocalMinute(day: Date, minute: number) {
  const result = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0,
  );
  result.setMinutes(minute);
  return result;
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Overlapping and touching blocks collapse so free time is never double-counted. */
export function mergeBusy(blocks: Array<{ start: number; end: number }>) {
  const sorted = [...blocks]
    .filter((block) => block.end > block.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
    else merged.push({ ...block });
  }
  return merged;
}

/**
 * Free windows inside one local day's working hours.
 *
 * Time already gone is never offered: for today the window opens at `now`, so
 * a brief built at 3pm cannot propose the morning.
 */
export function freeWindows(
  busy: BusyBlock[],
  day: Date,
  now: Date,
  hours: WorkingHours = defaultWorkingHours,
  options: CapacityOptions = defaultCapacityOptions,
): FreeWindow[] {
  if (!hours.days.includes(day.getDay())) return [];

  const dayStart = atLocalMinute(day, hours.startMinute).getTime();
  const dayEnd = atLocalMinute(day, hours.endMinute).getTime();
  if (dayEnd <= dayStart) return [];

  // Past days have no remaining capacity; today opens at the current moment.
  const startOfDay = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
  ).getTime();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (startOfDay < startOfToday) return [];

  const opensAt = isSameLocalDay(day, now)
    ? Math.max(dayStart, now.getTime())
    : dayStart;
  if (opensAt >= dayEnd) return [];

  const clipped = busy.flatMap((block) => {
    if (block.response === "declined") return [];
    // An all-day event either consumes the whole working day or is ignored;
    // its date-only bounds are never comparable to working-hour timestamps.
    if (block.allDay)
      return options.allDayBlocksDay ? [{ start: opensAt, end: dayEnd }] : [];
    const start = Date.parse(block.start);
    const end = Date.parse(block.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    return [{ start: Math.max(start, opensAt), end: Math.min(end, dayEnd) }];
  });

  const merged = mergeBusy(clipped);

  const windows: FreeWindow[] = [];
  let cursor = opensAt;
  for (const block of merged) {
    if (block.start > cursor)
      windows.push({
        start: new Date(cursor).toISOString(),
        end: new Date(block.start).toISOString(),
        minutes: Math.round((block.start - cursor) / 60_000),
      });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < dayEnd)
    windows.push({
      start: new Date(cursor).toISOString(),
      end: new Date(dayEnd).toISOString(),
      minutes: Math.round((dayEnd - cursor) / 60_000),
    });

  return windows.filter((window) => window.minutes >= options.minimumBlockMinutes);
}

/**
 * Usable minutes across free windows, after context-switch overhead.
 *
 * This is the number a realistic todo list is allowed to fill, and it is
 * deliberately smaller than the wall-clock gap between meetings.
 */
export function capacityMinutes(
  windows: FreeWindow[],
  options: CapacityOptions = defaultCapacityOptions,
) {
  return windows.reduce(
    (total, window) =>
      total + Math.max(0, window.minutes - options.contextSwitchMinutes),
    0,
  );
}

export function describeCapacity(minutes: number) {
  if (minutes <= 0) return "No usable time left today";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m of usable time`;
  return rest ? `${hours}h ${rest}m of usable time` : `${hours}h of usable time`;
}
