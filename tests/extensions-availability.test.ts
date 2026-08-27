import assert from "node:assert/strict";
import test from "node:test";
import {
  capacityMinutes,
  defaultCapacityOptions,
  defaultWorkingHours,
  describeCapacity,
  freeWindows,
  mergeBusy,
  type BusyBlock,
} from "../lib/extensions/availability";

/**
 * Fixtures are built in local time so the assertions hold in any timezone the
 * suite runs in, rather than only where they were written.
 */
function localIso(day: Date, hour: number, minute = 0) {
  const date = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hour,
    minute,
  );
  return date.toISOString();
}

/** A Wednesday. */
const day = new Date(2026, 7, 26);
const meeting = (from: number, to: number, extra: Partial<BusyBlock> = {}) => ({
  start: localIso(day, from),
  end: localIso(day, to),
  ...extra,
});

test("an empty calendar leaves the whole working day free", () => {
  const windows = freeWindows([], day, new Date(2026, 7, 26, 8));
  assert.equal(windows.length, 1);
  assert.equal(windows[0].minutes, 8 * 60);
  assert.equal(capacityMinutes(windows), 8 * 60 - 5);
});

test("meetings split the day into windows", () => {
  const windows = freeWindows(
    [meeting(10, 11), meeting(14, 15)],
    day,
    new Date(2026, 7, 26, 8),
  );
  assert.deepEqual(
    windows.map((window) => window.minutes),
    [60, 180, 120],
  );
});

test("gaps too short to work in are discarded, not counted", () => {
  // Busy 09:00-09:50 and 10:00-17:00 leaves exactly one 10-minute gap, which
  // is below the 25-minute floor and so is worth zero, not ten.
  const windows = freeWindows(
    [
      { start: localIso(day, 9), end: localIso(day, 9, 50) },
      { start: localIso(day, 10), end: localIso(day, 17) },
    ],
    day,
    new Date(2026, 7, 26, 8),
  );
  assert.deepEqual(windows, []);
  assert.equal(capacityMinutes(windows), 0);
});

test("capacity deducts context-switch cost per window", () => {
  const windows = freeWindows(
    [meeting(11, 12)],
    day,
    new Date(2026, 7, 26, 8),
  );
  // Two windows of 120 and 300 minutes, each paying 5 minutes of overhead.
  assert.deepEqual(windows.map((w) => w.minutes), [120, 300]);
  assert.equal(capacityMinutes(windows), 120 + 300 - 10);
});

test("time already gone is never offered", () => {
  const windows = freeWindows([], day, new Date(2026, 7, 26, 15));
  assert.equal(windows.length, 1);
  assert.equal(windows[0].minutes, 120);
});

test("a day that is already over has no capacity", () => {
  assert.deepEqual(freeWindows([], day, new Date(2026, 7, 26, 19)), []);
  assert.deepEqual(freeWindows([], day, new Date(2026, 7, 27, 9)), []);
});

test("weekends are not working days by default", () => {
  const saturday = new Date(2026, 7, 29);
  assert.deepEqual(freeWindows([], saturday, new Date(2026, 7, 29, 9)), []);
});

test("declined events do not consume time", () => {
  const windows = freeWindows(
    [meeting(9, 17, { response: "declined" })],
    day,
    new Date(2026, 7, 26, 8),
  );
  assert.equal(windows.length, 1);
  assert.equal(windows[0].minutes, 8 * 60);
});

test("tentative events still consume time", () => {
  const windows = freeWindows(
    [meeting(9, 12, { response: "tentative" })],
    day,
    new Date(2026, 7, 26, 8),
  );
  assert.deepEqual(windows.map((w) => w.minutes), [300]);
});

test("all-day events are ignored unless configured to block", () => {
  const allDay: BusyBlock[] = [
    { start: "2026-08-26", end: "2026-08-27", allDay: true, title: "Someone's birthday" },
  ];
  assert.equal(freeWindows(allDay, day, new Date(2026, 7, 26, 8)).length, 1);
  assert.deepEqual(
    freeWindows(allDay, day, new Date(2026, 7, 26, 8), defaultWorkingHours, {
      ...defaultCapacityOptions,
      allDayBlocksDay: true,
    }),
    [],
  );
});

test("overlapping meetings are not double-counted", () => {
  const windows = freeWindows(
    [meeting(10, 12), meeting(11, 13)],
    day,
    new Date(2026, 7, 26, 8),
  );
  assert.deepEqual(windows.map((w) => w.minutes), [60, 240]);
});

test("meetings outside working hours are clipped", () => {
  const windows = freeWindows(
    [{ start: localIso(day, 6), end: localIso(day, 10) }],
    day,
    new Date(2026, 7, 26, 5),
  );
  assert.deepEqual(windows.map((w) => w.minutes), [7 * 60]);
});

test("mergeBusy collapses touching and nested ranges", () => {
  assert.deepEqual(
    mergeBusy([
      { start: 10, end: 20 },
      { start: 20, end: 30 },
      { start: 12, end: 15 },
      { start: 50, end: 40 },
    ]),
    [{ start: 10, end: 30 }],
  );
});

test("malformed timestamps are skipped rather than crashing", () => {
  const windows = freeWindows(
    [{ start: "not-a-date", end: "also-not" }],
    day,
    new Date(2026, 7, 26, 8),
  );
  assert.equal(windows.length, 1);
});

test("capacity is described in human terms", () => {
  assert.equal(describeCapacity(0), "No usable time left today");
  assert.equal(describeCapacity(45), "45m of usable time");
  assert.equal(describeCapacity(120), "2h of usable time");
  assert.equal(describeCapacity(135), "2h 15m of usable time");
});
