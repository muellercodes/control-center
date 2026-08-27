import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanCalendarIds,
  cleanWorkingHours,
  isCalendarId,
  normalizeEvents,
} from "../lib/extensions/calendar";
import { defaultWorkingHours } from "../lib/extensions/availability";

test("calendar ids must be primary or email-shaped", () => {
  assert.equal(isCalendarId("primary"), true);
  assert.equal(isCalendarId("me@example.com"), true);
  assert.equal(isCalendarId("not an id"), false);
  assert.equal(isCalendarId(""), false);
});

test("calendar ids are normalized and deduplicated", () => {
  assert.deepEqual(
    cleanCalendarIds([" Me@Example.com ", "me@example.com", "primary", ""]),
    ["me@example.com", "primary"],
  );
  assert.throws(() => cleanCalendarIds(["nope"]), /not a valid calendar id/);
});

test("working hours must describe a forward-going window", () => {
  assert.throws(
    () => cleanWorkingHours({ startMinute: 600, endMinute: 600 }, defaultWorkingHours),
    /must end after it starts/,
  );
  assert.throws(
    () => cleanWorkingHours({ startMinute: 600, endMinute: 540 }, defaultWorkingHours),
    /must end after it starts/,
  );
  assert.throws(
    () => cleanWorkingHours({ days: [] }, defaultWorkingHours),
    /at least one working day/,
  );
});

test("working days are deduplicated, sorted, and range-checked", () => {
  const hours = cleanWorkingHours(
    { startMinute: 480, endMinute: 1020, days: [5, 1, 1, 9, -2, 3] },
    defaultWorkingHours,
  );
  assert.deepEqual(hours, { startMinute: 480, endMinute: 1020, days: [1, 3, 5] });
});

test("invalid minute values fall back rather than throwing", () => {
  const hours = cleanWorkingHours(
    { startMinute: "nine" as unknown as number, endMinute: 99_999 },
    defaultWorkingHours,
  );
  assert.deepEqual(hours, defaultWorkingHours);
});

test("timed and all-day Google events are distinguished", () => {
  const blocks = normalizeEvents({
    items: [
      {
        summary: "Standup",
        start: { dateTime: "2026-08-26T09:30:00-04:00" },
        end: { dateTime: "2026-08-26T09:45:00-04:00" },
      },
      {
        summary: "Conference",
        start: { date: "2026-08-26" },
        end: { date: "2026-08-27" },
      },
    ],
  });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].allDay, false);
  assert.equal(blocks[0].title, "Standup");
  assert.equal(blocks[1].allDay, true);
});

test("cancelled and free-marked events are dropped", () => {
  const blocks = normalizeEvents({
    items: [
      {
        summary: "Cancelled",
        status: "cancelled",
        start: { dateTime: "2026-08-26T09:00:00Z" },
        end: { dateTime: "2026-08-26T10:00:00Z" },
      },
      {
        summary: "Reminder, not a commitment",
        transparency: "transparent",
        start: { dateTime: "2026-08-26T09:00:00Z" },
        end: { dateTime: "2026-08-26T10:00:00Z" },
      },
    ],
  });
  assert.deepEqual(blocks, []);
});

test("the user's own response status is read from the attendee list", () => {
  const build = (responseStatus: string) =>
    normalizeEvents({
      items: [
        {
          summary: "Optional sync",
          start: { dateTime: "2026-08-26T09:00:00Z" },
          end: { dateTime: "2026-08-26T10:00:00Z" },
          attendees: [
            { email: "someone@example.com", responseStatus: "accepted" },
            { email: "me@example.com", self: true, responseStatus },
          ],
        },
      ],
    })[0];
  assert.equal(build("declined").response, "declined");
  assert.equal(build("tentative").response, "tentative");
  assert.equal(build("accepted").response, "accepted");
});

test("events without attendees count as accepted", () => {
  const [block] = normalizeEvents({
    items: [
      {
        summary: "Focus block",
        start: { dateTime: "2026-08-26T09:00:00Z" },
        end: { dateTime: "2026-08-26T10:00:00Z" },
      },
    ],
  });
  assert.equal(block.response, "accepted");
});

test("malformed payloads and entries are skipped", () => {
  assert.deepEqual(normalizeEvents(null), []);
  assert.deepEqual(normalizeEvents({ error: "nope" }), []);
  assert.deepEqual(
    normalizeEvents({ items: ["nope", null, { start: {}, end: {} }] }),
    [],
  );
});

test("an untitled event still reports as busy", () => {
  const [block] = normalizeEvents({
    items: [
      {
        start: { dateTime: "2026-08-26T09:00:00Z" },
        end: { dateTime: "2026-08-26T10:00:00Z" },
      },
    ],
  });
  assert.equal(block.title, "Busy");
});
