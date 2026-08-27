"use client";

import { CheckCircle2, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import type { DailyPlan } from "@/lib/extensions/plan";
import type { ThroughputConfidence } from "@/lib/extensions/throughput";
import styles from "./plan-view.module.css";
import { PageHeading, Panel, useExtensionFeed } from "./shared";

type PlanResponse = DailyPlan & {
  checkedAt: string;
  date: string;
  calendarState: "connected" | "not-connected" | "unavailable";
  confidence: ThroughputConfidence;
  activeDays: number;
  chronicallyDeferred: Array<{ id: string | number; title: string; ageDays: number }>;
};

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Says plainly how much the plan is trusting, and why. A short list with no
 * explanation reads as a bug; a short list with a stated reason reads as advice.
 */
function ConfidenceNote({ plan }: { plan: PlanResponse }) {
  const notes: string[] = [];
  if (plan.calendarState === "not-connected")
    notes.push(
      "No calendar connected, so nothing is capped by time — only by what you usually finish.",
    );
  if (plan.calendarState === "unavailable")
    notes.push(
      "The calendar could not be read just now, so today is not being capped by time.",
    );
  if (plan.confidence === "none")
    notes.push(
      `Only ${plan.activeDays} day${plan.activeDays === 1 ? "" : "s"} of completion history so far — too little to predict what you finish, so nothing is capped by throughput yet.`,
    );
  else if (plan.confidence === "low")
    notes.push(
      `Based on ${plan.activeDays} days of history, so treat the limit as a rough guide.`,
    );
  if (!notes.length) return null;
  return (
    <Panel className={styles.note}>
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </Panel>
  );
}

export function PlanView() {
  const feed = useExtensionFeed<PlanResponse>(
    "/api/live/plan",
    "/api/live/plan?refresh=1",
  );
  const plan = feed.data;

  return (
    <div className="view">
      <PageHeading
        eyebrow="Execution"
        title="Today"
        description="What can realistically get done, bounded by the time actually left and by what you usually finish."
        action={
          <button
            className="button button-primary"
            disabled={feed.loading}
            onClick={() => void feed.refresh()}
          >
            <RefreshCw size={15} className={feed.loading ? "spin" : ""} />
            Refresh
          </button>
        }
      />

      {feed.error && <p className="error-notice">{feed.error}</p>}

      {plan && (
        <>
          <Panel className={`${styles.hero} reveal`}>
            <div>
              <p className="eyebrow">Today&rsquo;s plan</p>
              <h2>
                {plan.picked.length}{" "}
                {plan.picked.length === 1 ? "task" : "tasks"}
                {plan.plannedMinutes > 0 && (
                  <span className={styles.heroMinutes}>
                    {" "}
                    · {minutesLabel(plan.plannedMinutes)}
                  </span>
                )}
              </h2>
              <p className={styles.heroDetail}>{plan.explanation}</p>
            </div>
            <div className={styles.heroStats}>
              <div>
                <b>
                  {plan.capacityMinutes === null
                    ? "—"
                    : minutesLabel(plan.capacityMinutes)}
                </b>
                <span>usable left</span>
              </div>
              <div>
                <b>{plan.throughputCap ?? "—"}</b>
                <span>typical/day</span>
              </div>
            </div>
          </Panel>

          <ConfidenceNote plan={plan} />

          <div className={`${styles.taskList} reveal delay-2`}>
            {plan.picked.map((entry, index) => (
              <article className={styles.taskRow} key={String(entry.task.id)}>
                <div className={styles.taskIndex}>
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className={styles.taskBody}>
                  <h3>{entry.task.title}</h3>
                  {entry.task.description &&
                    entry.task.description !== "No additional details." && (
                      <p>{entry.task.description}</p>
                    )}
                  <div className={styles.taskMeta}>
                    <span className={styles.taskTime}>
                      <Clock size={11} /> {minutesLabel(entry.estimateMinutes)}
                    </span>
                    {entry.estimateSource === "priority-default" && (
                      <span className={styles.taskTag}>estimated</span>
                    )}
                    {entry.overdueDays > 0 && (
                      <span className={styles.taskOverdue}>
                        {entry.overdueDays}d overdue
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}

            {!plan.picked.length && !feed.loading && (
              <Panel className="empty-state">
                <CheckCircle2 size={24} />
                <h2>
                  {plan.limitedBy === "nothing-due"
                    ? "Nothing due today"
                    : "No room left today"}
                </h2>
                <p>{plan.explanation}</p>
              </Panel>
            )}
          </div>

          {plan.spilled.length > 0 && (
            <Panel className={`${styles.spill} reveal`}>
              <p className="eyebrow">
                Not today · {plan.spilled.length}{" "}
                {plan.spilled.length === 1 ? "task" : "tasks"}
              </p>
              <ul>
                {plan.spilled.map((entry) => (
                  <li key={String(entry.task.id)}>
                    <span>{entry.task.title}</span>
                    <small>
                      {entry.reason === "no-time"
                        ? `needs ${minutesLabel(entry.estimateMinutes)}`
                        : "beyond a typical day"}
                    </small>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {plan.chronicallyDeferred.length > 0 && (
            <Panel className={`${styles.deferred} reveal`}>
              <p className="eyebrow">
                <TriangleAlert size={12} /> Carried for weeks
              </p>
              <p className={styles.deferredHint}>
                These have been open long enough that they are probably not
                going to happen. Worth rewriting into something smaller, or
                deleting.
              </p>
              <ul>
                {plan.chronicallyDeferred.map((entry) => (
                  <li key={String(entry.id)}>
                    <span>{entry.title}</span>
                    <small>{entry.ageDays}d old</small>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {!plan && !feed.loading && !feed.error && (
        <Panel className="empty-state">
          <CheckCircle2 size={24} />
          <h2>No plan yet</h2>
          <p>Add tasks on the Tasks tab and connect a calendar to bound the day.</p>
        </Panel>
      )}
    </div>
  );
}
