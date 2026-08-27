"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type {
  CalendarFeedResponse,
  PublicExtensionSettings,
} from "@/lib/extensions/types";
import { describeCapacity } from "@/lib/extensions/availability";
import styles from "./calendar-view.module.css";
import { Label, PageHeading, Panel, useExtensionFeed } from "./shared";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToTime(minutes: number) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
}

function formatDayLabel(date: string, index: number) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function clockRange(start: string, end: string) {
  const format = (value: string) =>
    new Date(value).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${format(start)} – ${format(end)}`;
}

function CalendarSetup({
  settings,
  onSaved,
}: {
  settings: PublicExtensionSettings;
  onSaved: (next: PublicExtensionSettings) => void;
}) {
  const calendar = settings.calendar;
  const [clientId, setClientId] = useState(calendar.googleClientId);
  const [clientSecret, setClientSecret] = useState("");
  const [calendarIds, setCalendarIds] = useState(calendar.calendarIds.join("\n"));
  const [startTime, setStartTime] = useState(
    minutesToTime(calendar.workingHours.startMinute),
  );
  const [endTime, setEndTime] = useState(
    minutesToTime(calendar.workingHours.endMinute),
  );
  const [days, setDays] = useState<number[]>(calendar.workingHours.days);
  const [minimumBlock, setMinimumBlock] = useState(calendar.minimumBlockMinutes);
  const [contextSwitch, setContextSwitch] = useState(calendar.contextSwitchMinutes);
  const [allDayBlocks, setAllDayBlocks] = useState(calendar.allDayBlocksDay);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const startMinute = timeToMinutes(startTime);
    const endMinute = timeToMinutes(endTime);
    if (startMinute === null || endMinute === null) {
      setError("Enter working hours as HH:MM.");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/extensions/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendar: {
            googleClientId: clientId.trim(),
            ...(clientSecret.trim()
              ? { googleClientSecret: clientSecret.trim() }
              : {}),
            calendarIds: calendarIds
              .split(/[\s,]+/)
              .map((entry) => entry.trim())
              .filter(Boolean),
            workingHours: { startMinute, endMinute, days },
            minimumBlockMinutes: Number(minimumBlock),
            contextSwitchMinutes: Number(contextSwitch),
            allDayBlocksDay: allDayBlocks,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save.");
      setClientSecret("");
      onSaved(payload as PublicExtensionSettings);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const redirectUri =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/extensions/auth/google/callback`;

  return (
    <Panel className="settings-panel reveal">
      <form onSubmit={save}>
        <div className="settings-field">
          <label htmlFor="calendar-client-id">Google OAuth client ID</label>
          <input
            id="calendar-client-id"
            value={clientId}
            autoComplete="off"
            placeholder="….apps.googleusercontent.com"
            onChange={(event) => setClientId(event.target.value)}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="calendar-client-secret">Client secret</label>
          <input
            id="calendar-client-secret"
            type="password"
            value={clientSecret}
            autoComplete="off"
            placeholder={
              calendar.googleClientSecretSet
                ? "Saved. Type a new secret to replace it."
                : "From the same OAuth client"
            }
            onChange={(event) => setClientSecret(event.target.value)}
          />
          <p className="fine-print">
            Add this exact redirect URI to the OAuth client:{" "}
            <code>{redirectUri}</code>. The requested scope is calendar
            read-only; Control Center never writes to your calendar.
          </p>
        </div>

        <div className="settings-field">
          <label htmlFor="calendar-ids">Calendars (optional)</label>
          <textarea
            id="calendar-ids"
            rows={2}
            value={calendarIds}
            placeholder={"primary\nteam@example.com"}
            onChange={(event) => setCalendarIds(event.target.value)}
          />
          <p className="fine-print">
            One per line. Leave empty to use just your primary calendar.
          </p>
        </div>

        <div className={styles.hoursGrid}>
          <div className="settings-field">
            <label htmlFor="calendar-start">Working day starts</label>
            <input
              id="calendar-start"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="calendar-end">Working day ends</label>
            <input
              id="calendar-end"
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </div>
        </div>

        <div className="settings-field">
          <label>Working days</label>
          <div className={styles.dayRow}>
            {WEEKDAYS.map((label, index) => (
              <button
                type="button"
                key={label}
                aria-pressed={days.includes(index)}
                className={
                  days.includes(index) ? styles.dayOn : styles.dayOff
                }
                onClick={() =>
                  setDays((current) =>
                    current.includes(index)
                      ? current.filter((day) => day !== index)
                      : [...current, index].sort(),
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.hoursGrid}>
          <div className="settings-field">
            <label htmlFor="calendar-minimum">Shortest usable block</label>
            <input
              id="calendar-minimum"
              type="number"
              min={0}
              max={240}
              value={minimumBlock}
              onChange={(event) => setMinimumBlock(Number(event.target.value))}
            />
            <p className="fine-print">
              Gaps shorter than this are not counted as work time at all.
            </p>
          </div>
          <div className="settings-field">
            <label htmlFor="calendar-switch">Context-switch cost</label>
            <input
              id="calendar-switch"
              type="number"
              min={0}
              max={60}
              value={contextSwitch}
              onChange={(event) => setContextSwitch(Number(event.target.value))}
            />
            <p className="fine-print">
              Deducted from every window for picking the work back up.
            </p>
          </div>
        </div>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={allDayBlocks}
            onChange={(event) => setAllDayBlocks(event.target.checked)}
          />
          <span>
            <b>All-day events consume the whole day</b>
            <small>
              Leave off if your all-day entries are mostly birthdays and
              reminders rather than time off.
            </small>
          </span>
        </label>

        {error && <p className="error-notice">{error}</p>}

        <div className={styles.actions}>
          <button className="button button-primary" disabled={saving}>
            {saving ? "Saving…" : "Save calendar settings"}
          </button>
          {calendar.googleClientSecretSet && clientId && (
            <a className="button" href="/api/extensions/auth/google/start">
              {calendar.connected
                ? "Reconnect Google Calendar"
                : "Connect Google Calendar"}
            </a>
          )}
        </div>
      </form>
    </Panel>
  );
}

export function CalendarView() {
  const feed = useExtensionFeed<CalendarFeedResponse>(
    "/api/live/calendar",
    "/api/live/calendar?refresh=1",
  );
  const [settings, setSettings] = useState<PublicExtensionSettings | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void fetch("/api/extensions/settings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setSettings(payload))
      .catch(() => undefined);
  }, []);

  const days = feed.data?.days ?? [];
  const connected = Boolean(feed.data?.connected);
  const today = days[0];

  return (
    <div className="view">
      <PageHeading
        eyebrow="Extension"
        title="Calendar"
        description="How much of the working day is actually left, after meetings, short gaps, and the cost of picking work back up."
        action={
          <div className="top-actions">
            <button
              className="button"
              onClick={() => setShowSettings((value) => !value)}
            >
              <Settings2 size={15} /> {showSettings ? "Hide setup" : "Setup"}
            </button>
            <button
              className="button button-primary"
              disabled={feed.loading}
              onClick={() => void feed.refresh()}
            >
              <RefreshCw size={15} className={feed.loading ? "spin" : ""} />
              Refresh
            </button>
          </div>
        }
      />

      {settings && (showSettings || !connected) && (
        <CalendarSetup
          key={settingsVersion}
          settings={settings}
          onSaved={(next) => {
            setSettings(next);
            setSettingsVersion((value) => value + 1);
            void feed.refresh();
          }}
        />
      )}

      {feed.error && <p className="error-notice">{feed.error}</p>}
      {feed.data?.errors?.map((message) => (
        <p className="error-notice" key={message}>
          {message}
        </p>
      ))}

      {today && (
        <Panel className={`${styles.hero} reveal`}>
          <p className="eyebrow">Remaining today</p>
          <h2>{describeCapacity(today.capacityMinutes)}</h2>
          <p className={styles.heroDetail}>
            {today.freeWindows.length
              ? `${today.freeWindows.length} usable ${
                  today.freeWindows.length === 1 ? "window" : "windows"
                } · ${today.busy.length} on the calendar`
              : `Nothing usable left · ${today.busy.length} on the calendar`}
          </p>
        </Panel>
      )}

      <div className="story-stack reveal delay-2">
        {days.map((day, index) => (
          <article className="story-card" key={day.date}>
            <div className="story-index">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="story-body">
              <div className="story-meta">
                <span>{formatDayLabel(day.date, index)}</span>
                <i />
                <Label tone={day.capacityMinutes ? "positive" : "watch"}>
                  {describeCapacity(day.capacityMinutes)}
                </Label>
              </div>
              {day.freeWindows.length ? (
                <ul className={styles.windowList}>
                  {day.freeWindows.map((window) => (
                    <li key={window.start}>
                      <CalendarClock size={12} />
                      <span>{clockRange(window.start, window.end)}</span>
                      <b>{window.minutes}m</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No window long enough to be worth starting something in.</p>
              )}
              {day.busy.length > 0 && (
                <p className={styles.busyLine}>
                  {day.busy
                    .slice(0, 4)
                    .map((block) => block.title)
                    .join(" · ")}
                  {day.busy.length > 4 ? ` · +${day.busy.length - 4} more` : ""}
                </p>
              )}
            </div>
          </article>
        ))}

        {!days.length && !feed.loading && (
          <Panel className="empty-state">
            <CheckCircle2 size={24} />
            <h2>
              {connected ? "No working days ahead" : "Calendar is not connected"}
            </h2>
            <p>
              {connected
                ? "The next seven days contain no configured working days."
                : "Add a Google OAuth client above, save, then choose Connect Google Calendar."}
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
