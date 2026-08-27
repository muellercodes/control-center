import type { TaskItem } from "@/lib/types";
import {
  expectedCompletions,
  type ThroughputEvidence,
} from "@/lib/extensions/throughput";

/**
 * Chooses the tasks that actually fit a given day.
 *
 * Two independent ceilings apply, and whichever binds first wins:
 *
 *   time       — the usable minutes left on the calendar
 *   throughput — how many things you historically finish on a day like this
 *
 * Either ceiling can be unknown (no calendar connected, not enough history).
 * An unknown ceiling must not silently behave like a ceiling of zero, so it is
 * modelled as null and simply does not constrain the selection. The result
 * always reports which constraint bound, so the UI can explain itself rather
 * than presenting an unexplained short list.
 */

/** Used when a task carries no explicit estimate. */
const DEFAULT_ESTIMATES: Record<string, number> = {
  high: 60,
  normal: 30,
  low: 15,
};

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

export type PlanEntry = {
  task: TaskItem;
  estimateMinutes: number;
  estimateSource: "explicit" | "priority-default";
  overdueDays: number;
};

export type PlanSpill = PlanEntry & { reason: "no-time" | "over-throughput" };

export type DailyPlan = {
  picked: PlanEntry[];
  spilled: PlanSpill[];
  /** Null when no calendar is connected. */
  capacityMinutes: number | null;
  plannedMinutes: number;
  /** Null when history is too thin to say. */
  throughputCap: number | null;
  limitedBy: "nothing-due" | "all-fit" | "time" | "throughput";
  explanation: string;
};

export function estimateFor(task: TaskItem): {
  estimateMinutes: number;
  estimateSource: PlanEntry["estimateSource"];
} {
  if (task.estimateMinutes && task.estimateMinutes > 0)
    return { estimateMinutes: task.estimateMinutes, estimateSource: "explicit" };
  return {
    estimateMinutes: DEFAULT_ESTIMATES[task.priority?.toLowerCase()] ?? 30,
    estimateSource: "priority-default",
  };
}

function localDateValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Whole days a task is past due. Free-text due values such as the legacy
 * "Today" are treated as due now rather than being dropped.
 */
export function overdueDays(task: TaskItem, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.due)) return 0;
  const [year, month, day] = task.due.split("-").map(Number);
  const due = new Date(year, month - 1, day).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((today - due) / 86_400_000));
}

function isDueBy(task: TaskItem, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.due)) return true;
  return task.due <= localDateValue(now);
}

function describe(plan: Omit<DailyPlan, "explanation">): string {
  if (plan.limitedBy === "nothing-due") return "Nothing is due today.";
  const count = plan.picked.length;
  const noun = count === 1 ? "task" : "tasks";

  if (plan.limitedBy === "all-fit") {
    // Never claim the list "fits the time available" when no calendar reported
    // any time. An unbounded list is honest only if it says it is unbounded.
    if (plan.capacityMinutes === null && plan.throughputCap === null)
      return `All ${count} ${noun} due today are listed. Nothing is bounding the day yet — connect a calendar and build up some completion history to get a real limit.`;
    if (plan.capacityMinutes === null)
      return `All ${count} ${noun} due today are within a typical day for you, though the calendar is not bounding the time.`;
    return `All ${count} ${noun} due today fit the ${plan.capacityMinutes} usable minutes left.`;
  }

  if (plan.limitedBy === "time")
    return `${count} ${noun} fit the ${plan.capacityMinutes} usable minutes left today. ${plan.spilled.length} did not.`;
  return `Held to ${count} ${noun} because that is what you typically finish on a day like today. ${plan.spilled.length} held back.`;
}

export function buildDailyPlan({
  tasks,
  capacityMinutes,
  evidence,
  now = new Date(),
}: {
  tasks: TaskItem[];
  capacityMinutes: number | null;
  evidence: ThroughputEvidence | null;
  now?: Date;
}): DailyPlan {
  const throughputCap = evidence ? expectedCompletions(evidence, now) : null;

  const candidates: PlanEntry[] = tasks
    .filter((task) => !task.done && isDueBy(task, now))
    .map((task) => ({
      task,
      ...estimateFor(task),
      overdueDays: overdueDays(task, now),
    }))
    // Most overdue first, then by priority, then shortest — so that when the
    // day is tight, the tie is broken toward fitting more real work in.
    .sort(
      (a, b) =>
        b.overdueDays - a.overdueDays ||
        (PRIORITY_RANK[a.task.priority?.toLowerCase()] ?? 1) -
          (PRIORITY_RANK[b.task.priority?.toLowerCase()] ?? 1) ||
        a.estimateMinutes - b.estimateMinutes,
    );

  const picked: PlanEntry[] = [];
  const spilled: PlanSpill[] = [];
  let plannedMinutes = 0;
  let hitTime = false;
  let hitThroughput = false;

  for (const entry of candidates) {
    if (throughputCap !== null && picked.length >= throughputCap) {
      hitThroughput = true;
      spilled.push({ ...entry, reason: "over-throughput" });
      continue;
    }
    if (
      capacityMinutes !== null &&
      plannedMinutes + entry.estimateMinutes > capacityMinutes
    ) {
      hitTime = true;
      spilled.push({ ...entry, reason: "no-time" });
      continue;
    }
    picked.push(entry);
    plannedMinutes += entry.estimateMinutes;
  }

  const limitedBy: DailyPlan["limitedBy"] = !candidates.length
    ? "nothing-due"
    : !spilled.length
      ? "all-fit"
      : hitTime && !hitThroughput
        ? "time"
        : hitThroughput && !hitTime
          ? "throughput"
          : // Both bound; report the one that stopped the list first.
            spilled[0].reason === "no-time"
            ? "time"
            : "throughput";

  const base = {
    picked,
    spilled,
    capacityMinutes,
    plannedMinutes,
    throughputCap,
    limitedBy,
  };
  return { ...base, explanation: describe(base) };
}
