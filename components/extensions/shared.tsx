"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Local copies of the handful of presentational primitives the built-in views
 * use. They are intentionally duplicated rather than imported from
 * control-center.tsx: importing would create a cycle (registry -> view ->
 * control-center -> registry) and would force an `export` edit onto a file that
 * upstream rewrites constantly. Fifty lines of duplication buys independence.
 */

export function classNames(
  ...values: Array<string | false | null | undefined>
) {
  return values.filter(Boolean).join(" ");
}

export function Panel({
  children,
  className = "",
  ...props
}: React.ComponentPropsWithoutRef<"section">) {
  return (
    <section className={`panel ${className}`} {...props}>
      {children}
    </section>
  );
}

export function Label({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={classNames(
        "label",
        tone && `label-${tone.toLowerCase().replaceAll(" ", "-")}`,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading reveal">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const difference = Date.now() - date.getTime();
  if (difference < 60 * 60 * 1000)
    return `${Math.max(1, Math.round(difference / 60_000))} min ago`;
  if (difference < 24 * 60 * 60 * 1000)
    return `${Math.round(difference / 3_600_000)} hr ago`;
  const days = Math.round(difference / 86_400_000);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

/**
 * Minimal feed hook. Unlike the built-in useLiveData it holds no module-level
 * cache, because extension snapshots are already cached server-side in SQLite
 * and a tab switch therefore costs nothing.
 *
 * The initial load deliberately touches state only after the await: setting it
 * synchronously in the effect body triggers a cascading render, which React's
 * compiler lint rejects.
 */
export function useExtensionFeed<T>(endpoint: string, refreshEndpoint = endpoint) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || "Request failed.");
        setData(payload as T);
        setError("");
      } catch (requestError) {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Request failed.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  // Called from event handlers, where synchronous state updates are fine.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(refreshEndpoint, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request failed.");
      setData(payload as T);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Request failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [refreshEndpoint]);

  return { data, loading, error, setData, refresh };
}
