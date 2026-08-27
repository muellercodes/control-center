import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyPlan, estimateFor, overdueDays } from "../lib/extensions/plan";
import { summarizeThroughput } from "../lib/extensions/throughput";
import type { TaskItem } from "../lib/types";

const now = new Date(2026, 7, 26, 9);

let sequence = 0;
function task(overrides: Partial<TaskItem> = {}): TaskItem {
  sequence += 1;
  return {
    id: `task-${sequence}`,
    title: `Task ${sequence}`,
    description: "",
    due: "2026-08-26",
    recurrence: "One-time",
    priority: "Normal",
    done: false,
    ...overrides,
  };
}

/** History with enough active days to produce a confident cap of 3. */
function historyWithCap(perDay: number, days: number): TaskItem[] {
  const items: TaskItem[] = [];
  for (let day = 1; day <= days; day += 1)
    for (let index = 0; index < perDay; index += 1)
      items.push(
        task({
          done: true,
          completedAt: new Date(2026, 7, 26 - day, 9 + index).toISOString(),
        }),
      );
  return items;
}

test("explicit estimates win over the priority default", () => {
  assert.deepEqual(estimateFor(task({ estimateMinutes: 45 })), {
    estimateMinutes: 45,
    estimateSource: "explicit",
  });
  assert.deepEqual(estimateFor(task({ priority: "High" })), {
    estimateMinutes: 60,
    estimateSource: "priority-default",
  });
  assert.deepEqual(estimateFor(task({ priority: "Low" })), {
    estimateMinutes: 15,
    estimateSource: "priority-default",
  });
  assert.equal(estimateFor(task({ priority: "Weird" })).estimateMinutes, 30);
});

test("overdue days are counted from the local due date", () => {
  assert.equal(overdueDays(task({ due: "2026-08-26" }), now), 0);
  assert.equal(overdueDays(task({ due: "2026-08-20" }), now), 6);
  assert.equal(overdueDays(task({ due: "2026-09-01" }), now), 0);
  assert.equal(overdueDays(task({ due: "Today" }), now), 0);
});

test("nothing due produces an explicit empty plan", () => {
  const plan = buildDailyPlan({
    tasks: [task({ due: "2026-09-10" })],
    capacityMinutes: 480,
    evidence: null,
    now,
  });
  assert.equal(plan.limitedBy, "nothing-due");
  assert.equal(plan.picked.length, 0);
  assert.match(plan.explanation, /Nothing is due/);
});

test("time is the binding constraint when the day is short", () => {
  const plan = buildDailyPlan({
    tasks: [
      task({ estimateMinutes: 60 }),
      task({ estimateMinutes: 60 }),
      task({ estimateMinutes: 60 }),
    ],
    capacityMinutes: 90,
    evidence: null,
    now,
  });
  assert.equal(plan.picked.length, 1);
  assert.equal(plan.plannedMinutes, 60);
  assert.equal(plan.limitedBy, "time");
  assert.deepEqual(
    plan.spilled.map((entry) => entry.reason),
    ["no-time", "no-time"],
  );
});

test("throughput is the binding constraint when time is plentiful", () => {
  const evidence = summarizeThroughput(historyWithCap(2, 12), now);
  assert.equal(evidence.confidence, "medium");
  const plan = buildDailyPlan({
    tasks: Array.from({ length: 8 }, () => task({ estimateMinutes: 15 })),
    capacityMinutes: 480,
    evidence,
    now,
  });
  assert.equal(plan.throughputCap, 2);
  assert.equal(plan.picked.length, 2);
  assert.equal(plan.limitedBy, "throughput");
  assert.match(plan.explanation, /typically finish/);
});

test("an unknown calendar does not behave like zero capacity", () => {
  const plan = buildDailyPlan({
    tasks: [task({ estimateMinutes: 600 })],
    capacityMinutes: null,
    evidence: null,
    now,
  });
  assert.equal(plan.picked.length, 1);
  assert.equal(plan.limitedBy, "all-fit");
});

test("thin history does not cap the list", () => {
  const evidence = summarizeThroughput(historyWithCap(1, 2), now);
  assert.equal(evidence.confidence, "none");
  const plan = buildDailyPlan({
    tasks: Array.from({ length: 5 }, () => task({ estimateMinutes: 10 })),
    capacityMinutes: 480,
    evidence,
    now,
  });
  assert.equal(plan.throughputCap, null);
  assert.equal(plan.picked.length, 5);
});

test("a fully booked day plans nothing and says why", () => {
  const plan = buildDailyPlan({
    tasks: [task({ estimateMinutes: 30 })],
    capacityMinutes: 0,
    evidence: null,
    now,
  });
  assert.equal(plan.picked.length, 0);
  assert.equal(plan.limitedBy, "time");
});

test("the most overdue task is scheduled first", () => {
  const plan = buildDailyPlan({
    tasks: [
      task({ title: "Today", due: "2026-08-26", estimateMinutes: 30 }),
      task({ title: "Ancient", due: "2026-08-01", estimateMinutes: 30 }),
      task({ title: "Yesterday", due: "2026-08-25", estimateMinutes: 30 }),
    ],
    capacityMinutes: 30,
    evidence: null,
    now,
  });
  assert.equal(plan.picked[0].task.title, "Ancient");
});

test("priority breaks ties, then the shorter task wins", () => {
  const plan = buildDailyPlan({
    tasks: [
      task({ title: "Long normal", estimateMinutes: 120 }),
      task({ title: "Short normal", estimateMinutes: 20 }),
      task({ title: "High", priority: "High", estimateMinutes: 90 }),
    ],
    capacityMinutes: 1000,
    evidence: null,
    now,
  });
  assert.deepEqual(
    plan.picked.map((entry) => entry.task.title),
    ["High", "Short normal", "Long normal"],
  );
});

test("completed tasks are never planned", () => {
  const plan = buildDailyPlan({
    tasks: [task({ done: true, completedAt: now.toISOString() })],
    capacityMinutes: 480,
    evidence: null,
    now,
  });
  assert.equal(plan.limitedBy, "nothing-due");
});

test("a smaller task still fits after a larger one spills", () => {
  // The 120-minute task cannot fit in 60 minutes, but the 30-minute one can,
  // so the day is not abandoned after the first miss.
  const plan = buildDailyPlan({
    tasks: [
      task({ title: "Big", priority: "High", estimateMinutes: 120 }),
      task({ title: "Small", estimateMinutes: 30 }),
    ],
    capacityMinutes: 60,
    evidence: null,
    now,
  });
  assert.deepEqual(
    plan.picked.map((entry) => entry.task.title),
    ["Small"],
  );
  assert.equal(plan.limitedBy, "time");
});

test("an unbounded plan says so instead of claiming a fit", () => {
  const plan = buildDailyPlan({
    tasks: [task({ estimateMinutes: 600 }), task({ estimateMinutes: 600 })],
    capacityMinutes: null,
    evidence: null,
    now,
  });
  assert.equal(plan.limitedBy, "all-fit");
  // 20 hours of work must never be described as fitting the day.
  assert.doesNotMatch(plan.explanation, /fit the/);
  assert.match(plan.explanation, /Nothing is bounding the day yet/);
});

test("a known capacity is quoted when everything fits", () => {
  const plan = buildDailyPlan({
    tasks: [task({ estimateMinutes: 30 })],
    capacityMinutes: 240,
    evidence: null,
    now,
  });
  assert.match(plan.explanation, /fit the 240 usable minutes/);
});

test("a throughput-only bound does not imply the calendar was consulted", () => {
  const evidence = summarizeThroughput(historyWithCap(5, 12), now);
  const plan = buildDailyPlan({
    tasks: [task({ estimateMinutes: 30 })],
    capacityMinutes: null,
    evidence,
    now,
  });
  assert.equal(plan.limitedBy, "all-fit");
  assert.match(plan.explanation, /calendar is not bounding/);
});
