import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedCompletions,
  median,
  summarizeThroughput,
} from "../lib/extensions/throughput";
import type { TaskItem } from "../lib/types";

const now = new Date(2026, 7, 26, 12);

let sequence = 0;
function completed(daysAgo: number, hour = 10): TaskItem {
  sequence += 1;
  const at = new Date(2026, 7, 26 - daysAgo, hour);
  return {
    id: `done-${sequence}`,
    title: `Task ${sequence}`,
    description: "",
    due: "Today",
    recurrence: "One-time",
    priority: "Normal",
    done: true,
    completedAt: at.toISOString(),
  };
}

function open(createdDaysAgo: number): TaskItem {
  sequence += 1;
  return {
    id: `open-${sequence}`,
    title: `Open ${sequence}`,
    description: "",
    due: "Today",
    recurrence: "One-time",
    priority: "Normal",
    done: false,
    createdAt: new Date(2026, 7, 26 - createdDaysAgo, 9).toISOString(),
  };
}

test("median handles even and odd counts", () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([5, 1, 3]), 3);
});

test("thin history yields no number at all", () => {
  const evidence = summarizeThroughput([completed(1), completed(2)], now);
  assert.equal(evidence.activeDays, 2);
  assert.equal(evidence.confidence, "none");
  assert.equal(expectedCompletions(evidence, now), null);
});

test("confidence rises with the number of active days", () => {
  const build = (days: number) =>
    summarizeThroughput(
      Array.from({ length: days }, (_, index) => completed(index + 1)),
      now,
    );
  assert.equal(build(4).confidence, "none");
  assert.equal(build(6).confidence, "low");
  assert.equal(build(12).confidence, "medium");
  assert.equal(build(25).confidence, "high");
});

test("typical throughput is the median of active days, not the mean", () => {
  // Five ordinary days of 2, plus one outlier day of 20.
  const tasks = [
    ...[1, 2, 3, 4, 5].flatMap((daysAgo) => [
      completed(daysAgo, 9),
      completed(daysAgo, 11),
    ]),
    ...Array.from({ length: 20 }, (_, index) => completed(6, 9 + (index % 8))),
  ];
  const evidence = summarizeThroughput(tasks, now);
  assert.equal(evidence.activeDays, 6);
  // A mean would be badly inflated by the outlier; the median is not.
  assert.equal(evidence.medianOnActiveDays, 2);
});

test("completions outside the window are ignored", () => {
  const evidence = summarizeThroughput(
    [completed(1), completed(60), completed(90)],
    now,
  );
  assert.equal(evidence.activeDays, 1);
});

test("future-dated and unparseable completions are ignored", () => {
  const bogus: TaskItem[] = [
    { ...completed(1), completedAt: "not-a-date" },
    { ...completed(1), completedAt: new Date(2027, 0, 1).toISOString() },
  ];
  assert.equal(summarizeThroughput(bogus, now).activeDays, 0);
});

test("per-weekday medians need at least three samples for that weekday", () => {
  // 2026-08-26 is a Wednesday, so 7, 14, 21 days back are also Wednesdays.
  const evidence = summarizeThroughput(
    [7, 14, 21].flatMap((daysAgo) => [completed(daysAgo, 9), completed(daysAgo, 11)]),
    now,
  );
  assert.equal(evidence.perWeekday[3], 2);
  assert.equal(evidence.perWeekday[1], undefined);
});

test("a weekday median beats the overall median when available", () => {
  const tasks = [
    // Three Wednesdays with one completion each.
    ...[7, 14, 21].map((daysAgo) => completed(daysAgo, 9)),
    // Other days with five each, to pull the overall median up.
    ...[1, 2, 3].flatMap((daysAgo) =>
      Array.from({ length: 5 }, (_, index) => completed(daysAgo, 9 + index)),
    ),
  ];
  const evidence = summarizeThroughput(tasks, now);
  assert.equal(evidence.confidence, "low");
  assert.equal(expectedCompletions(evidence, new Date(2026, 7, 26)), 1);
});

test("chronically deferred tasks are surfaced oldest first", () => {
  const evidence = summarizeThroughput(
    [open(3), open(40), open(20), completed(1)],
    now,
  );
  assert.deepEqual(
    evidence.chronicallyDeferred.map((task) => task.ageDays),
    [40, 20],
  );
});

test("expected completions never proposes zero", () => {
  const evidence = summarizeThroughput(
    Array.from({ length: 10 }, (_, index) => completed(index + 1)),
    now,
  );
  assert.equal(evidence.confidence, "medium");
  assert.equal(expectedCompletions(evidence, now), 1);
});
