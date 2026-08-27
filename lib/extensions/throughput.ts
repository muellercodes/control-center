import type { TaskItem } from "@/lib/types";

/**
 * What the task history says you actually get done, as opposed to what you
 * intended to.
 *
 * Every figure here is derived from `completedAt`, which the built-in Tasks tab
 * already records on every completion (including one immutable occurrence per
 * recurring task), so this needs no change to the upstream task shape.
 *
 * The guiding rule is that thin evidence produces no number at all. Claiming
 * "you finish 3 a day" from four data points would be worse than saying
 * nothing, so confidence is reported and callers are expected to honour it.
 */

export type ThroughputConfidence = "none" | "low" | "medium" | "high";

export type ThroughputEvidence = {
  /** Distinct local days in the window on which at least one task was completed. */
  activeDays: number;
  /** Typical completions on a day you completed anything. */
  medianOnActiveDays: number;
  /** Median completions per local weekday, 0 = Sunday. Absent when unknown. */
  perWeekday: Record<number, number>;
  confidence: ThroughputConfidence;
  /** Open tasks old enough that they are evidently never going to be done. */
  chronicallyDeferred: Array<{ id: TaskItem["id"]; title: string; ageDays: number }>;
};

const DEFERRAL_AGE_DAYS = 14;

function localDayKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function confidenceFor(activeDays: number): ThroughputConfidence {
  if (activeDays < 5) return "none";
  if (activeDays < 10) return "low";
  if (activeDays < 20) return "medium";
  return "high";
}

export function summarizeThroughput(
  tasks: TaskItem[],
  now = new Date(),
  windowDays = 42,
): ThroughputEvidence {
  const cutoff = now.getTime() - windowDays * 86_400_000;

  const byDay = new Map<string, { count: number; weekday: number }>();
  for (const task of tasks) {
    if (!task.done || !task.completedAt) continue;
    const completed = new Date(task.completedAt);
    const time = completed.getTime();
    // Ignore unparseable stamps and anything outside the window, including
    // future-dated rows that a clock change or bad import could introduce.
    if (!Number.isFinite(time) || time < cutoff || time > now.getTime()) continue;
    const key = localDayKey(completed);
    const existing = byDay.get(key);
    if (existing) existing.count += 1;
    else byDay.set(key, { count: 1, weekday: completed.getDay() });
  }

  const counts = [...byDay.values()];
  const perWeekday: Record<number, number> = {};
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const forDay = counts
      .filter((entry) => entry.weekday === weekday)
      .map((entry) => entry.count);
    if (forDay.length >= 3) perWeekday[weekday] = median(forDay);
  }

  const chronicallyDeferred = tasks
    .flatMap((task) => {
      if (task.done || !task.createdAt) return [];
      const created = Date.parse(task.createdAt);
      if (!Number.isFinite(created)) return [];
      const ageDays = Math.floor((now.getTime() - created) / 86_400_000);
      if (ageDays < DEFERRAL_AGE_DAYS) return [];
      return [{ id: task.id, title: task.title, ageDays }];
    })
    .sort((a, b) => b.ageDays - a.ageDays);

  return {
    activeDays: byDay.size,
    medianOnActiveDays: median(counts.map((entry) => entry.count)),
    perWeekday,
    confidence: confidenceFor(byDay.size),
    chronicallyDeferred,
  };
}

/**
 * How many tasks the evidence supports proposing for a given day.
 *
 * Returns null when there is not enough history to say, which callers must
 * treat as "do not cap by throughput" rather than as zero.
 */
export function expectedCompletions(
  evidence: ThroughputEvidence,
  day: Date,
): number | null {
  if (evidence.confidence === "none") return null;
  const forWeekday = evidence.perWeekday[day.getDay()];
  if (forWeekday !== undefined) return Math.max(1, Math.round(forWeekday));
  if (!evidence.medianOnActiveDays) return null;
  return Math.max(1, Math.round(evidence.medianOnActiveDays));
}
